import asyncio
import logging
import os
import uuid

from google import genai
from google.genai import types

logger = logging.getLogger("mia.tools")

# Cheap model for search — fast, low cost, no thinking
SEARCH_MODEL = os.getenv("SEARCH_MODEL", "gemini-2.5-flash-lite")


# ── Per-session state ────────────────────────────────────────────


class SessionToolState:
    """Holds all tool state for a single WebSocket session."""

    def __init__(self, event_queue: asyncio.Queue):
        self.event_queue = event_queue
        self.preferences: dict[str, str] = {}
        # timer_id → {label, duration_seconds, paused, remaining_when_paused, set_at}
        self.active_timers: dict[str, dict] = {}

    def emit(self, event: dict):
        try:
            self.event_queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("Event queue full, dropping: %s", event.get("type"))

    def get_timer_label(self, timer_id: str) -> str | None:
        timer = self.active_timers.get(timer_id)
        return timer["label"] if timer else None

    def mark_timer_expired(self, timer_id: str):
        self.active_timers.pop(timer_id, None)


# ── Tool functions ───────────────────────────────────────────────


def update_user_preference(state: SessionToolState, key: str, value: str) -> dict:
    """Save a user preference (allergies, dietary restrictions, skill level, serving size)."""
    state.preferences[key] = value
    logger.info("Preference saved: %s = %s", key, value)
    state.emit({"type": "preference_updated", "key": key, "value": value})
    return {"status": "saved", "key": key, "value": value}


def _find_timer_by_label(state: SessionToolState, label: str) -> tuple[str, dict] | None:
    """Find a timer by label (case-insensitive). Returns (timer_id, timer_data) or None."""
    for tid, t in state.active_timers.items():
        if t["label"].lower() == label.lower():
            return tid, t
    return None


def _get_remaining(timer: dict) -> int:
    """Get remaining seconds for a timer (works for both running and paused)."""
    if timer.get("paused"):
        return timer.get("remaining_when_paused", 0)
    import time
    elapsed = time.time() - timer["set_at"]
    return max(0, int(timer["duration_seconds"] - elapsed))


def manage_timer(
    state: SessionToolState, action: str, label: str = "",
    duration_seconds: int = 0, timer_id: str = "", adjust_seconds: int = 0,
) -> dict:
    """Manage cooking timers. Actions: set, cancel, pause, resume, adjust, restart, status."""
    import time
    action = action.lower()

    # Resolve timer_id from label if not provided
    if not timer_id and label and action != "set":
        found = _find_timer_by_label(state, label)
        if found:
            timer_id, _ = found

    if action == "set":
        if duration_seconds <= 0:
            return {"error": "duration_seconds must be positive"}
        tid = str(uuid.uuid4())[:8]
        state.active_timers[tid] = {
            "label": label,
            "duration_seconds": duration_seconds,
            "set_at": time.time(),
            "paused": False,
            "remaining_when_paused": 0,
        }
        logger.info("Timer set: id=%s label=%s seconds=%d", tid, label, duration_seconds)
        state.emit({
            "type": "timer_set",
            "timer_id": tid,
            "label": label,
            "duration_seconds": duration_seconds,
        })
        return {"status": "set", "timer_id": tid, "label": label, "duration_seconds": duration_seconds}

    elif action == "cancel":
        if timer_id and timer_id in state.active_timers:
            removed = state.active_timers.pop(timer_id)
            logger.info("Timer cancelled: id=%s label=%s", timer_id, removed["label"])
            state.emit({"type": "timer_cancelled", "timer_id": timer_id})
            return {"status": "cancelled", "timer_id": timer_id}
        return {"status": "cancelled", "message": "Timer not found or already expired"}

    elif action == "pause":
        timer = state.active_timers.get(timer_id)
        if not timer:
            return {"error": "Timer not found"}
        if timer["paused"]:
            return {"status": "already paused", "timer_id": timer_id}
        remaining = _get_remaining(timer)
        timer["paused"] = True
        timer["remaining_when_paused"] = remaining
        logger.info("Timer paused: id=%s remaining=%ds", timer_id, remaining)
        state.emit({"type": "timer_paused", "timer_id": timer_id, "remaining_seconds": remaining})
        return {"status": "paused", "timer_id": timer_id, "remaining_seconds": remaining}

    elif action == "resume":
        timer = state.active_timers.get(timer_id)
        if not timer:
            return {"error": "Timer not found"}
        if not timer["paused"]:
            return {"status": "already running", "timer_id": timer_id}
        remaining = timer["remaining_when_paused"]
        timer["paused"] = False
        timer["set_at"] = time.time()
        timer["duration_seconds"] = remaining
        timer["remaining_when_paused"] = 0
        logger.info("Timer resumed: id=%s remaining=%ds", timer_id, remaining)
        state.emit({"type": "timer_resumed", "timer_id": timer_id, "remaining_seconds": remaining})
        return {"status": "resumed", "timer_id": timer_id, "remaining_seconds": remaining}

    elif action == "adjust":
        timer = state.active_timers.get(timer_id)
        if not timer:
            return {"error": "Timer not found"}
        remaining = _get_remaining(timer)
        new_remaining = max(1, remaining + adjust_seconds)
        if timer["paused"]:
            timer["remaining_when_paused"] = new_remaining
        else:
            timer["set_at"] = time.time()
            timer["duration_seconds"] = new_remaining
        logger.info("Timer adjusted: id=%s by=%+ds new_remaining=%ds", timer_id, adjust_seconds, new_remaining)
        state.emit({"type": "timer_adjusted", "timer_id": timer_id, "new_remaining_seconds": new_remaining})
        return {"status": "adjusted", "timer_id": timer_id, "new_remaining_seconds": new_remaining}

    elif action == "restart":
        timer = state.active_timers.get(timer_id)
        if not timer:
            return {"error": "Timer not found"}
        original = timer["duration_seconds"] if not timer["paused"] else timer.get("remaining_when_paused", timer["duration_seconds"])
        # Use the original duration from when it was first set (if we stored it)
        restart_duration = duration_seconds if duration_seconds > 0 else timer["duration_seconds"]
        timer["set_at"] = time.time()
        timer["duration_seconds"] = restart_duration
        timer["paused"] = False
        timer["remaining_when_paused"] = 0
        logger.info("Timer restarted: id=%s duration=%ds", timer_id, restart_duration)
        state.emit({"type": "timer_restarted", "timer_id": timer_id, "duration_seconds": restart_duration})
        return {"status": "restarted", "timer_id": timer_id, "duration_seconds": restart_duration}

    elif action == "status":
        if not state.active_timers:
            return {"status": "no active timers"}
        return {
            "status": "active",
            "timers": [
                {"timer_id": tid, "label": t["label"], "remaining_seconds": _get_remaining(t), "paused": t["paused"]}
                for tid, t in state.active_timers.items()
            ],
        }

    return {"error": f"Unknown action: {action}"}


# ── Search tool (async — calls cheap model with Google Search) ───


async def search_web(state: SessionToolState, query: str, search_client: genai.Client) -> dict:
    """Search the web using a cheap model with Google Search grounding."""
    state.emit({"type": "search_started"})
    try:
        response = await search_client.aio.models.generate_content(
            model=SEARCH_MODEL,
            contents=query,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        answer = response.text or "No results found."
        logger.info("Search complete: query=%s answer_len=%d", query, len(answer))
        state.emit({"type": "search_complete"})
        return {"answer": answer}
    except Exception as e:
        logger.exception("Search failed: %s", query)
        state.emit({"type": "search_complete"})
        return {"answer": f"I couldn't look that up right now, but from what I know: (search error: {e})"}


# ── Tool dispatch ────────────────────────────────────────────────

_TOOL_FUNCTIONS = {
    "update_user_preference": update_user_preference,
    "manage_timer": manage_timer,
}

# search_web is async and handled separately in main.py
ASYNC_TOOLS = {"search_web"}


def dispatch_tool_call(state: SessionToolState, name: str, args: dict) -> dict:
    """Execute a sync tool by name and return its result."""
    fn = _TOOL_FUNCTIONS.get(name)
    if not fn:
        logger.warning("Unknown tool: %s", name)
        return {"error": f"Unknown tool: {name}"}
    try:
        return fn(state, **args)
    except Exception as e:
        logger.exception("Tool %s failed", name)
        return {"error": str(e)}


# ── SDK tool declarations ────────────────────────────────────────


def get_tool_declarations() -> list[types.Tool]:
    """Return tool declarations for LiveConnectConfig."""
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="update_user_preference",
                    description="SILENT EXECUTION — call immediately without speaking. Save a user preference such as allergies, dietary restrictions, skill level, or serving size. Only speak after receiving the result.",
                    parameters=types.Schema(
                        type="OBJECT",
                        properties={
                            "key": types.Schema(
                                type="STRING",
                                description="The preference category",
                                enum=["allergies", "dietary", "skill_level", "serving_size"],
                            ),
                            "value": types.Schema(
                                type="STRING",
                                description="The preference value (e.g. 'nuts', 'vegetarian', 'beginner', '2')",
                            ),
                        },
                        required=["key", "value"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="manage_timer",
                    description="SILENT EXECUTION — call immediately without speaking. Manage cooking timers. Set, cancel, pause, resume, adjust, restart, or check status. Only speak after receiving the result.",
                    parameters=types.Schema(
                        type="OBJECT",
                        properties={
                            "action": types.Schema(
                                type="STRING",
                                description="The action to perform",
                                enum=["set", "cancel", "pause", "resume", "adjust", "restart", "status"],
                            ),
                            "label": types.Schema(
                                type="STRING",
                                description="Timer label (e.g. 'pasta'). Required for 'set'. Used to find timers for other actions.",
                            ),
                            "duration_seconds": types.Schema(
                                type="INTEGER",
                                description="Duration in seconds. Required for 'set'.",
                            ),
                            "timer_id": types.Schema(
                                type="STRING",
                                description="The timer ID. Required for cancel/pause/resume/adjust/restart if label not provided.",
                            ),
                            "adjust_seconds": types.Schema(
                                type="INTEGER",
                                description="Seconds to add (positive) or subtract (negative). Required for 'adjust'.",
                            ),
                        },
                        required=["action"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="search_web",
                    description="Search the web for cooking information, food safety facts, recipes, or ingredient substitutions. Use when the user asks a factual question you're not 100% sure about.",
                    parameters=types.Schema(
                        type="OBJECT",
                        properties={
                            "query": types.Schema(
                                type="STRING",
                                description="The search query (e.g. 'safe internal temperature for chicken breast')",
                            ),
                        },
                        required=["query"],
                    ),
                ),
            ],
        ),
    ]
