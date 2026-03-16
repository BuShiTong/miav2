import asyncio
import logging
import re
import time
import uuid

from google.genai import types

logger = logging.getLogger("mia.tools")


# ── Validation keywords (for transcription-based tool call validation) ────

# Timer actions: keyword must appear in user's speech to allow the action
TIMER_ACTION_KEYWORDS = {
    "pause": ["pause", "stop", "hold", "freeze"],
    "resume": ["resume", "start", "continue", "unpause"],
    "cancel": ["cancel", "remove", "delete", "clear", "stop"],
    "adjust": ["add", "more time", "less time", "extend", "extra", "subtract"],
}

# Removal-intent keywords for preference negation validation
REMOVAL_KEYWORDS = [
    "remove", "clear", "delete", "reset", "forget",
    "no", "none", "nothing", "don't", "not", "without",
    "scratch", "never mind", "drop",
]

# Broad scope words (user wants to clear all preferences, not a specific key)
BROAD_SCOPE_WORDS = ["all", "everything", "both", "every"]

# Dietary label → implied avoidance values
# When user says "I'm vegetarian", model sends value="meat" — this mapping
# lets validation accept the implied value if the label appears in transcription.
_DIETARY_LABEL_MAP: dict[str, set[str]] = {
    "vegetarian": {"meat", "poultry", "chicken", "beef", "pork", "lamb"},
    "vegan": {"meat", "dairy", "eggs", "honey", "animal products", "poultry",
              "chicken", "beef", "pork", "lamb", "milk", "cheese"},
    "pescatarian": {"meat", "poultry", "chicken", "beef", "pork", "lamb"},
    "lactose intolerant": {"dairy", "lactose", "milk", "cheese"},
    "gluten free": {"gluten", "wheat", "flour"},
}


def validate_tool_call(name: str, args: dict, transcription: str) -> tuple[bool, str]:
    """Validate a tool call against the user's transcription.

    Returns (allowed: bool, reason: str).
    Fail-open: if transcription is empty, allow the call (except camera_control).
    camera_control is always strict — the user must explicitly ask for it.
    """
    # Camera control: always strict, never fail-open.
    # Prevents Gemini from hallucinating camera-on at session start.
    # Uses component matching: requires "camera" + action word in transcription.
    if name == "camera_control":
        action = (args.get("action") or "").lower()
        if not transcription or not transcription.strip():
            return False, f"camera_control('{action}') requires explicit user request (no transcription)"
        text = transcription.lower()
        if "camera" not in text:
            return False, "no 'camera' keyword in transcription"
        if action == "on":
            action_words = ["turn on", "enable", "start", "open", "turning on", "camera on"]
            # Natural speech: "turn the camera on" (split phrasing)
            split_check = ("turn" in text and "on" in text)
        elif action == "off":
            action_words = ["turn off", "disable", "stop", "close", "turning off", "camera off"]
            split_check = ("turn" in text and "off" in text)
        elif action == "flip":
            action_words = ["flip", "switch"]
            split_check = False
            # Compound check: direction word + action word (e.g. "switch to front camera")
            direction_words = ["front", "back", "rear", "selfie"]
            flip_action_words = ["switch", "flip", "change", "turn"]
            has_direction = any(w in text for w in direction_words)
            has_flip_action = any(w in text for w in flip_action_words)
            if has_direction and has_flip_action:
                return True, f"direction + flip action found for '{action}'"
        else:
            return False, f"unknown camera action '{action}' — rejected"
        for aw in action_words:
            if aw in text:
                return True, f"'{aw}' + 'camera' found for action '{action}'"
        if split_check:
            return True, f"'turn' + '{action}' found separately for action '{action}'"
        return False, f"no action word for camera action '{action}'"

    if not transcription or not transcription.strip():
        return True, "fail-open (no transcription)"

    text = transcription.lower()

    if name == "update_user_preference":
        value = (args.get("value") or "").lower()
        key = (args.get("key") or "").lower()
        if not value:
            return True, "no value to check"

        # Negation values: model might say "clear" but user said "remove"
        # Check (1) removal intent AND (2) key-related words, food item, or broad scope
        if value in _NEGATION_VALUES or value.startswith("no "):
            has_removal_intent = any(
                re.search(r'\b' + re.escape(kw) + r'\b', text)
                for kw in REMOVAL_KEYWORDS
            )
            # For "avoid" key, user won't say "avoid" — match reason words or broad scope
            _REASON_WORDS = ["allergy", "allergies", "allergic", "dietary", "diet", "dislike", "preference", "preferences"]
            has_key_or_scope = (
                re.search(r'\b' + re.escape(key) + r'\b', text)
                or any(re.search(r'\b' + re.escape(w) + r'\b', text) for w in BROAD_SCOPE_WORDS)
                or any(re.search(r'\b' + re.escape(w) + r'\b', text) for w in _REASON_WORDS)
            )
            if has_removal_intent and has_key_or_scope:
                return True, f"removal intent + key/scope found for negation '{value}'"
            if has_removal_intent:
                return True, f"removal intent found for negation '{value}' (broad context)"
            return False, f"no removal intent for negation value '{value}'"

        # For avoid preferences, check if the food/ingredient value appears
        if re.search(r'\b' + re.escape(value) + r'\b', text):
            return True, f"value '{value}' found in transcription"
        # Dietary label → implied value (e.g., "vegetarian" in speech implies "meat")
        if args.get("reason", "").lower() == "dietary":
            for label, implied_values in _DIETARY_LABEL_MAP.items():
                if re.search(r'\b' + re.escape(label) + r'\b', text) and value in implied_values:
                    return True, f"dietary label '{label}' implies '{value}'"
        return False, f"value '{value}' not found in transcription"

    if name == "manage_timer":
        action = (args.get("action") or "").lower()
        keywords = TIMER_ACTION_KEYWORDS.get(action)
        if keywords is None:
            # set, status, or unknown — always allowed
            return True, f"action '{action}' always allowed"
        for kw in keywords:
            if re.search(r'\b' + re.escape(kw) + r'\b', text):
                return True, f"keyword '{kw}' found for action '{action}'"
        return False, f"no keyword for action '{action}' found in transcription"

    # Unknown tool: allow (fail-open)
    return True, "unknown tool — fail-open"


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


_NEGATION_VALUES = {
    "none", "no", "nothing", "n/a", "na", "no allergies",
    "no restrictions", "no dietary restrictions", "not applicable",
    "clear", "remove",
}

def _parse_avoid_items(raw: str) -> list[tuple[str, str]]:
    """Parse avoid string into list of (value, reason) tuples.

    Format: "peanuts (allergy), vegan (dietary), cilantro (dislike)"
    """
    if not raw:
        return []
    items = []
    for part in raw.split(", "):
        part = part.strip()
        match = re.match(r'^(.+?)\s*\((\w+)\)$', part)
        if match:
            items.append((match.group(1).strip(), match.group(2).strip()))
        elif part:
            items.append((part, "dislike"))
    return items


def _build_avoid_string(items: list[tuple[str, str]]) -> str:
    """Build avoid string from list of (value, reason) tuples."""
    return ", ".join(f"{v} ({r})" for v, r in items)


def update_user_preference(state: SessionToolState, key: str, value: str, reason: str = "") -> dict:
    """Save a food avoidance with reason (allergy, dietary, dislike)."""
    value = value.strip()
    reason = (reason or "dislike").lower()

    # Negation: "none", "clear", etc. → remove the preference
    if value.lower() in _NEGATION_VALUES or value.lower().startswith("no "):
        removed = state.preferences.pop(key, None)
        logger.info("Preference cleared: %s (was %s)", key, removed)
        state.emit({"type": "preference_updated", "key": key, "value": ""})
        return {
            "status": "cleared",
            "key": key,
            "all_preferences": dict(state.preferences),
        }

    # Avoid: accumulate items with reasons, dedup by value
    existing = _parse_avoid_items(state.preferences.get("avoid", ""))
    new_items = [item.strip().lower() for item in value.split(",") if item.strip()]

    for new_val in new_items:
        # Check if item already exists (update reason if different)
        found = False
        for i, (ev, er) in enumerate(existing):
            if ev == new_val:
                if er != reason:
                    existing[i] = (new_val, reason)
                    logger.info("Avoid reason updated: %s %s → %s", new_val, er, reason)
                found = True
                break
        if not found:
            existing.append((new_val, reason))

    result = _build_avoid_string(existing)
    state.preferences["avoid"] = result
    logger.info("Preference saved: avoid = %s", result)
    state.emit({"type": "preference_updated", "key": "avoid", "value": result})
    return {
        "status": "saved",
        "key": "avoid",
        "value": result,
        "all_preferences": dict(state.preferences),
    }


def _find_timer_by_label(state: SessionToolState, label: str) -> tuple[str, dict] | None:
    """Find a timer by label (case-insensitive). Returns (timer_id, timer_data) or None."""
    for tid, t in state.active_timers.items():
        if t["label"].lower() == label.lower():
            return tid, t
    return None


def _format_duration(seconds: int) -> str:
    """Convert seconds to human-readable string: '5 minutes', '2 minutes 30 seconds'."""
    if seconds < 1:
        return "0 seconds"
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    parts = []
    if h:
        parts.append(f"{h} hour{'s' if h != 1 else ''}")
    if m:
        parts.append(f"{m} minute{'s' if m != 1 else ''}")
    if s and not h:  # skip seconds when hours are involved
        parts.append(f"{s} second{'s' if s != 1 else ''}")
    return " ".join(parts) or "0 seconds"


def _get_remaining(timer: dict) -> int:
    """Get remaining seconds for a timer (works for both running and paused)."""
    if timer.get("paused"):
        return timer.get("remaining_when_paused", 0)
    elapsed = time.time() - timer["set_at"]
    return max(0, int(timer["duration_seconds"] - elapsed))


MAX_ACTIVE_TIMERS = 5
MIN_DURATION = 1
MAX_DURATION = 28800  # 8 hours


def sanitize_label(label: str) -> str:
    """Strip special characters from timer labels to prevent prompt injection."""
    return re.sub(r'[^\w\s-]', '', label)[:50].strip()


def manage_timer(
    state: SessionToolState, action: str, label: str = "",
    duration_seconds: int = 0, timer_id: str = "", adjust_seconds: int = 0,
) -> dict:
    """Manage cooking timers. Actions: set, cancel, pause, resume, adjust."""
    action = action.lower()

    # Sanitize label
    if label:
        label = sanitize_label(label)

    # Resolve timer_id from label if not provided
    if not timer_id and label and action != "set":
        found = _find_timer_by_label(state, label)
        if found:
            timer_id, _ = found

    if action == "set":
        if not label or not label.strip():
            return {"error": "Please specify what this timer is for (e.g., 'pasta', 'rice')"}
        if duration_seconds < MIN_DURATION or duration_seconds > MAX_DURATION:
            return {"error": f"Duration must be between {MIN_DURATION}s and {MAX_DURATION}s (8 hours)"}
        if len(state.active_timers) >= MAX_ACTIVE_TIMERS:
            return {"error": f"Maximum {MAX_ACTIVE_TIMERS} active timers. Cancel one first."}
        # Dedup: if a timer with the same label was created within the last 10 seconds, skip
        if label:
            for existing_id, existing in state.active_timers.items():
                if existing["label"].lower() == label.lower() and time.time() - existing["set_at"] < 10:
                    logger.info("Timer dedup: '%s' already set %0.1fs ago (id=%s)", label, time.time() - existing["set_at"], existing_id)
                    return {"status": "already set", "timer_id": existing_id, "label": label, "duration_seconds": existing["duration_seconds"]}
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
        return {"status": "set", "timer_id": tid, "label": label, "duration_seconds": duration_seconds, "duration_display": _format_duration(duration_seconds)}

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
        return {"status": "paused", "timer_id": timer_id, "remaining_seconds": remaining, "remaining_display": _format_duration(remaining)}

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
        return {"status": "resumed", "timer_id": timer_id, "remaining_seconds": remaining, "remaining_display": _format_duration(remaining)}

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
        return {"status": "adjusted", "timer_id": timer_id, "new_remaining_seconds": new_remaining, "remaining_display": _format_duration(new_remaining)}

    return {"error": f"Unknown action: {action}"}


def camera_control(state: SessionToolState, action: str) -> dict:
    """Control the user's camera (on/off/flip). Fire-and-forget via event."""
    action = action.lower()
    if action not in ("on", "off", "flip"):
        return {"error": f"Unknown camera action: {action}"}
    state.emit({"type": "camera_control", "action": action})
    logger.info("Camera control: %s", action)
    return {"status": "ok", "action": action}


# ── Tool dispatch ────────────────────────────────────────────────

_TOOL_FUNCTIONS = {
    "update_user_preference": update_user_preference,
    "manage_timer": manage_timer,
    "camera_control": camera_control,
}


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
                    description="Save what the user wants to avoid eating.",
                    parameters=types.Schema(
                        type="OBJECT",
                        properties={
                            "key": types.Schema(
                                type="STRING",
                                description="The preference type",
                                enum=["avoid"],
                            ),
                            "value": types.Schema(
                                type="STRING",
                                description="The food or ingredient to avoid (e.g. 'peanuts', 'cilantro')",
                            ),
                            "reason": types.Schema(
                                type="STRING",
                                description="Why they avoid it.",
                                enum=["allergy", "dietary", "dislike"],
                            ),
                        },
                        required=["key", "value"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="manage_timer",
                    description="Manage cooking timers. Set, cancel, pause, resume, or adjust timers.",
                    parameters=types.Schema(
                        type="OBJECT",
                        properties={
                            "action": types.Schema(
                                type="STRING",
                                description="The action to perform",
                                enum=["set", "cancel", "pause", "resume", "adjust"],
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
                                description="The timer ID. Required for cancel/pause/resume/adjust if label not provided.",
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
                    name="camera_control",
                    description="Control the user's camera. Turn it on, off, or flip between front and back.",
                    parameters=types.Schema(
                        type="OBJECT",
                        properties={
                            "action": types.Schema(
                                type="STRING",
                                description="The camera action",
                                enum=["on", "off", "flip"],
                            ),
                        },
                        required=["action"],
                    ),
                ),
            ],
        ),
        types.Tool(google_search=types.GoogleSearch()),
    ]
