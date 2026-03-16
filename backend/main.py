import asyncio
import base64
import hmac
import json
import logging
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

# Windows console encoding fix — prevents crash on emoji/unicode from Gemini
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from google import genai
from google.genai import types

from tools import (
    get_tool_declarations,
    dispatch_tool_call,
    SessionToolState,
    validate_tool_call,
    sanitize_label,
)

# ── Per-user state that survives WebSocket reconnects ──
# Connection lifetime is ~10 min; handles are valid ~24 hours on Vertex.
# Resume handles: stored by user_id so reconnecting clients resume with preserved context.
# Each entry is (handle_string, stored_timestamp) for age-based cleanup.
_resume_handles: dict[str, tuple[str, float]] = {}
_RESUME_HANDLE_MAX_AGE = 86_400  # 24 hours — Vertex handle validity
# Saved preferences: keyed by user_id, persisted across Gemini crashes so allergies
# aren't lost when the connection resets. Cleared on clean disconnect (user clicks Stop).
# Each entry is (prefs_dict, stored_timestamp) for age-based cleanup.
_saved_preferences: dict[str, tuple[dict[str, str], float]] = {}

LOG_DIR = Path(__file__).parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("mia")


def _create_session_logger(session_id: str) -> logging.Logger:
    """Create a per-session file logger. DEBUG level captures everything."""
    short_id = session_id.split("_")[-1][:8] if "_" in session_id else session_id[:8]
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    filename = LOG_DIR / f"{timestamp}_{short_id}.log"

    session_logger = logging.getLogger(f"mia.session.{short_id}")
    session_logger.setLevel(logging.DEBUG)
    handler = logging.FileHandler(filename, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    session_logger.addHandler(handler)
    logger.info("Session log: %s", filename)
    return session_logger

# ── SDK client ───────────────────────────────────────────────

client = genai.Client(
    vertexai=True,
    project=os.environ["GOOGLE_CLOUD_PROJECT"],
    location=os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1"),
)
MODEL = os.getenv("GEMINI_MODEL", "gemini-live-2.5-flash-native-audio")

SYSTEM_INSTRUCTION = """\
You are Mia — a skilled home cook and the user's kitchen buddy. You've been 
cooking your whole life and you love helping people make good food at home. 
You're patient, direct, and honest. You talk like a friend who happens to be 
great at cooking — no lectures, no judgment, no fake enthusiasm. Use simple 
everyday language. Have opinions about food when asked, but respect the user's choices.

Stay on cooking and food topics. If the conversation drifts, bring it back naturally.

PACING:
Match the user's current mode. If they're actively cooking — hands busy, 
things on the stove — keep answers short and actionable. If they're planning 
or browsing, you can be more conversational. When in doubt, be brief. 
The user can always ask for more detail.

If the user goes quiet, don't fill the silence. They're probably busy. Wait 
for them to come back.

FIRST EXCHANGE:
Greet the user and introduce yourself as Mia. Find out if they already know 
what they want to cook or need help deciding. Sound like a friend they just 
walked up to in the kitchen — warm but not scripted. Vary your greeting each time.

GETTING TO KNOW THEM (MANDATORY):
Before giving any recipe steps or ingredient lists, you MUST ask if there 
are ingredients they need to avoid. Do not skip this even if the
user seems eager to start. Work it into the conversation naturally — don't
make it feel like a checklist, but DO ask before moving forward. This is a
safety requirement, not optional.

HELPING THEM COOK:
Walk through recipes one step at a time. Check in before moving to the next step — 
let the user set the pace. Answer food questions as they come up.
If they have food avoidances, flag risky ingredients before they come into play.
Read the user's cooking level and match it — more detail for beginners, 
less hand-holding for experienced cooks.

If an ingredient is missing, suggest a substitution before the user has to ask.

SAFETY:
Be direct and clear about food safety — allergies, temperatures, storage, 
cross-contamination. This is the one area where you don't soften your language. 
If something could make someone sick, say so plainly.

HONESTY:
If you're not sure about something, say so. Never guess about food safety, 
nutritional claims, or cooking times for unfamiliar dishes. Use Google Search 
instead. It's better to say "let me check" than to give a wrong answer.

When things go wrong — burned, oversalted, collapsed — acknowledge it without 
making it a big deal. Help the user recover or pivot. Don't pretend it didn't happen.

TOOLS:
- update_user_preference: Save food avoidances when the user mentions them —
whether it's an allergy, a dietary choice, or something they just don't like.
Note the reason so you know how seriously to treat it.
- manage_timer: Set, cancel, pause, resume, or adjust cooking timers when asked.
- camera_control: Turn camera on/off or flip when asked.
- Google Search: Use for important info you're not sure about. Never guess about 
food safety, cooking temperatures, storage times, cross-contamination, substitutions, 
recipes.
Use tools when the user asks or when clearly needed.
When multiple tools run, you must respond exactly once covering everything.
"""

# ── Preference injection helper ─────────────────────────────


def _format_pref_injection(preferences: dict[str, str]) -> str:
    """Format preferences for injection into the model's context.

    Produces a compact string the model can parse, with severity guidance
    so it knows how seriously to treat each avoidance type.
    """
    parts = []
    if "avoid" in preferences:
        parts.append(f"User avoids: {preferences['avoid']}.")
    if "avoid" in preferences:
        parts.append(
            "Allergies = safety-critical, never include. "
            "Dietary = always respect. "
            "Dislikes = skip but can mention if relevant."
        )
    return " ".join(parts)


# ── App setup ───────────────────────────────────────────────

app = FastAPI()

_default_origins = [
    "http://localhost:5173",
    "http://localhost:4173",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:4173",
]
_extra_origins = os.getenv("CORS_ORIGINS", "")
_cors_origins = _default_origins + [o.strip() for o in _extra_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Stub endpoints ──────────────────────────────────────────

class VerifyCodeRequest(BaseModel):
    code: str = ""


@app.post("/api/verify-code")
async def verify_code(req: VerifyCodeRequest):
    expected = os.getenv("ACCESS_CODE", "cookwithmia26")
    if hmac.compare_digest(req.code.strip(), expected):
        return {"valid": True}
    return {"valid": False, "error": "Wrong code \u2014 Mia peeked through the peephole and didn't recognize you."}


@app.post("/api/frontend-logs")
async def frontend_logs(request: Request):
    try:
        body = await request.json()
        logs = body.get("logs", [])
        if not logs:
            return {"ok": True}

        log_file = LOG_DIR / "frontend.log"
        with open(log_file, "a", encoding="utf-8") as f:
            for entry in logs:
                ts = entry.get("ts", "")
                level = entry.get("level", "INFO")
                module = entry.get("module", "?")
                sid = entry.get("sessionId", "?")[:16]
                msg = entry.get("msg", "")[:500]
                data = entry.get("data")
                line = f"{ts} [{level}] {module} (sid={sid}): {msg}"
                if data is not None:
                    line += f" | {json.dumps(data, default=str)[:1000]}"
                f.write(line + "\n")
        return {"ok": True}
    except Exception as e:
        logger.warning("Frontend log write failed: %s", e)
        return {"ok": False}


@app.get("/health")
async def health():
    return {"status": "ok"}


# ── WebSocket send helper ──────────────────────────────────

# Valid WebSocket path parameter pattern: alphanumeric, underscores, hyphens only.
# Prevents log injection (newlines in logged IDs) and path issues (session_id used in log filenames).
_VALID_ID = re.compile(r"^[a-zA-Z0-9_-]+$")
_MAX_ID_LENGTH = 128

WS_SEND_TIMEOUT = 5.0  # seconds — prevents zombie connections from blocking tasks


async def _safe_send(ws: WebSocket, data: dict, slog: logging.Logger) -> bool:
    """Send JSON to WebSocket with timeout. Returns False if send failed (dead client)."""
    try:
        await asyncio.wait_for(ws.send_text(json.dumps(data)), timeout=WS_SEND_TIMEOUT)
        return True
    except asyncio.TimeoutError:
        slog.warning("WebSocket send timed out (%.1fs) — client likely dead", WS_SEND_TIMEOUT)
        return False
    except (RuntimeError, WebSocketDisconnect):
        return False


# ── WebSocket endpoint ──────────────────────────────────────

@app.websocket("/ws/{user_id}/{session_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str, session_id: str):
    await websocket.accept()

    if (
        len(user_id) > _MAX_ID_LENGTH
        or len(session_id) > _MAX_ID_LENGTH
        or not _VALID_ID.match(user_id)
        or not _VALID_ID.match(session_id)
    ):
        logger.warning(
            "Rejected WebSocket: invalid ID format (user=%.32s… session=%.32s…)",
            user_id, session_id,
        )
        await websocket.close(code=1008, reason="Invalid ID format")
        return

    logger.info("Connected: user=%s session=%s", user_id, session_id)
    slog = _create_session_logger(session_id)
    slog.info("Connected: user=%s session=%s", user_id, session_id)

    # Per-session state: event queue + tool state
    event_queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    tool_state = SessionToolState(event_queue)

    # Check for a stored resumption handle from a previous connection
    stored = _resume_handles.get(user_id)
    resume_handle = stored[0] if stored else None
    is_resuming = resume_handle is not None

    # Restore preferences from a previous session (survives Gemini crashes)
    # so allergies/dietary info aren't lost on reconnect
    if is_resuming:
        saved = _saved_preferences.get(user_id)
        if saved:
            try:
                tool_state.preferences = dict(saved[0])
                # Re-emit preference events so frontend chips appear
                for key, value in tool_state.preferences.items():
                    tool_state.emit({"type": "preference_updated", "key": key, "value": value})
                slog.info("Restored %d preferences for user %s: %s",
                          len(saved), user_id, saved)
            except Exception:
                slog.warning("Failed to restore preferences — starting fresh")

    config = types.LiveConnectConfig(
        temperature=0.6,
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Aoede")
            ),
        ),
        system_instruction=SYSTEM_INSTRUCTION,
        tools=get_tool_declarations(),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_LOW,
                end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
                prefix_padding_ms=300,      # Require 300ms sustained speech before interrupting (filters kitchen noise bursts <200ms)
                silence_duration_ms=500,    # Wait 500ms silence before ending user turn (tolerates brief pauses)
            )
        ),
        # Vertex AI-only features (rejected on AI Studio, accepted on Vertex)
        enable_affective_dialog=True,
        # Context window compression: discard oldest turns when tokens exceed trigger
        # Audio burns ~25 tokens/sec, camera ~258 tokens/sec
        # At 100K trigger: audio-only ~66 min, camera ~6 min before first compression
        context_window_compression=types.ContextWindowCompressionConfig(
            sliding_window=types.SlidingWindow(target_tokens=80_000),
            trigger_tokens=100_000,
        ),
        # Session resumption: preserve context across reconnections (~10 min connection lifetime)
        # Handles valid ~24 hours on Vertex AI
        session_resumption=types.SessionResumptionConfig(handle=resume_handle),
    )

    try:
        async with client.aio.live.connect(model=MODEL, config=config) as session:
            slog.info(
                "Live session opened: model=%s compression=trigger@100k/target@80k resuming=%s",
                MODEL, is_resuming,
            )

            if not is_resuming:
                # Fresh session: trigger Mia's greeting
                await session.send_client_content(
                    turns=types.Content(
                        role="user",
                        parts=[types.Part(text="[Session started]")],
                    ),
                    turn_complete=True,
                )
                slog.debug("Greeting sent")
            else:
                slog.info("Resumed session — skipping greeting")

            async def upstream():
                """Browser → Gemini: forward audio, video frames, and timer events."""
                MAX_MESSAGE_LEN = 10_000     # text message cap (chars)
                MAX_IMAGE_B64_LEN = 2_800_000  # ~2MB decoded
                audio_count = 0
                last_image_time = 0.0
                try:
                    while True:
                        raw = await websocket.receive_text()

                        # Input size cap (image frames are large but allowed through)
                        if len(raw) > MAX_MESSAGE_LEN:
                            head = raw[:60]
                            if '"type":"image"' not in head and '"type": "image"' not in head:
                                slog.warning("Dropping oversized message: %d chars", len(raw))
                                continue

                        try:
                            msg = json.loads(raw)
                        except (json.JSONDecodeError, ValueError):
                            continue

                        msg_type = msg.get("type")

                        if msg_type == "audio":
                            try:
                                audio_bytes = base64.b64decode(msg["data"])
                            except Exception:
                                continue
                            await session.send_realtime_input(
                                audio=types.Blob(
                                    data=audio_bytes,
                                    mime_type="audio/pcm;rate=16000",
                                )
                            )
                            audio_count += 1
                            if audio_count % 125 == 1:
                                slog.debug("Upstream: audio chunk #%d (%d bytes)", audio_count, len(audio_bytes))

                        elif msg_type == "image":
                            now = time.time()
                            if now - last_image_time < 1.0:
                                continue
                            image_data = msg.get("data", "")
                            if len(image_data) > MAX_IMAGE_B64_LEN:
                                slog.warning("Dropping oversized image: %d chars", len(image_data))
                                continue
                            last_image_time = now
                            try:
                                image_bytes = base64.b64decode(image_data)
                            except Exception:
                                continue
                            try:
                                await session.send_realtime_input(
                                    media=types.Blob(
                                        data=image_bytes,
                                        mime_type="image/jpeg",
                                    )
                                )
                                slog.debug("Upstream: image frame (%d bytes)", len(image_bytes))
                            except Exception:
                                slog.exception("Failed to send image frame")

                        elif msg_type == "timer_expired":
                            timer_id = msg.get("timer_id", "")
                            label = sanitize_label(msg.get("label", "timer")) or "timer"
                            slog.info("Timer expired: id=%s label=%s", timer_id, label)
                            tool_state.mark_timer_expired(timer_id)
                            await session.send_client_content(
                                turns=types.Content(
                                    role="user",
                                    parts=[types.Part(text=f"[Timer expired: {label}]")],
                                ),
                                turn_complete=True,
                            )

                except WebSocketDisconnect:
                    slog.info("Client disconnected (upstream)")
                except Exception:
                    slog.exception("Upstream error")

            async def downstream():
                """Gemini → Browser: forward audio, handle tool calls."""
                ready_sent = False
                msg_count = 0
                user_transcript: list[str] = []
                mia_transcript: list[str] = []
                last_user_transcription = ""  # latest complete user transcription
                # Periodic system instruction updates — survives compression
                REINFORCE_INTERVAL = 300  # 5 minutes
                last_reinforce_time = time.time()
                # Tool call buffering: collect calls for 300ms, then validate + execute
                pending_tool_calls: list = []
                tool_buffer_task: asyncio.Task | None = None
                TOOL_BUFFER_MS = 300  # ms to wait for batched tool calls
                # Retry cap: track rejections per (tool, args) to stop infinite loops
                # Key: "tool_name:sorted_args", Value: rejection count
                # Resets when user speaks new words (last_user_transcription changes)
                rejection_counts: dict[str, int] = {}
                rejection_transcript: str = ""  # transcript snapshot when counts were recorded
                MAX_REJECTIONS = 3
                # Double-talk gate: after tool responses, allow 1 model turn,
                # suppress extras until user speaks (or 10s safety valve).
                post_tool_turn_gate = False   # True after we send tool_response
                block_extra_turns = False     # True after first post-tool turn completes
                gate_set_time: float = 0.0    # For 10-second safety valve
                GATE_TIMEOUT = 10.0           # seconds — auto-clear if no duplicate
                try:
                    slog.debug("Downstream: starting receive loop")
                    MAX_RECEIVE_REENTRIES = 5
                    reentry_count = 0
                    while True:
                        reentry_count += 1
                        if reentry_count > MAX_RECEIVE_REENTRIES:
                            slog.warning("session.receive() ended %d times without data — ending downstream", reentry_count)
                            break
                        async for response in session.receive():
                            msg_count += 1
                            reentry_count = 0  # Reset — got data

                            if not ready_sent:
                                ready_sent = True
                                if not await _safe_send(websocket, {"type": "ready"}, slog):
                                    break
                                slog.info("Ready signal sent")

                            # ── Tool calls (buffered + validated) ──
                            if response.tool_call:
                                fc_list = response.tool_call.function_calls or []
                                slog.info("Tool call received: %d function(s): %s",
                                          len(fc_list),
                                          [fc.name for fc in fc_list])
                                pending_tool_calls.extend(fc_list)

                                async def _flush_tool_buffer():
                                    """Wait for buffer window, then validate + execute + respond."""
                                    nonlocal pending_tool_calls, tool_buffer_task, rejection_counts, rejection_transcript, post_tool_turn_gate, block_extra_turns
                                    await asyncio.sleep(TOOL_BUFFER_MS / 1000)
                                    calls = pending_tool_calls[:]
                                    pending_tool_calls.clear()
                                    tool_buffer_task = None
                                    if not calls:
                                        return

                                    transcript = last_user_transcription
                                    func_responses = []

                                    # Dedup: remove duplicate tool calls (same name + same args)
                                    # Prevents hallucination loops from flooding Gemini with responses
                                    seen: set[tuple] = set()
                                    unique_calls: list = []
                                    for fc in calls:
                                        key = (fc.name, tuple(sorted((fc.args or {}).items())))
                                        if key in seen:
                                            slog.info("Tool call dedup: dropped duplicate %s(%s)", fc.name, fc.args)
                                            func_responses.append(types.FunctionResponse(
                                                id=fc.id, name=fc.name,
                                                response={"status": "duplicate", "reason": "already requested in this batch"},
                                            ))
                                            continue
                                        seen.add(key)
                                        unique_calls.append(fc)
                                    if len(calls) != len(unique_calls):
                                        slog.info("Tool call dedup: %d → %d unique calls", len(calls), len(unique_calls))

                                    # Safety cap: limit unique calls per batch
                                    MAX_TOOL_CALLS_PER_BATCH = 10
                                    if len(unique_calls) > MAX_TOOL_CALLS_PER_BATCH:
                                        slog.warning("Tool call cap: %d unique calls, processing first %d",
                                                     len(unique_calls), MAX_TOOL_CALLS_PER_BATCH)
                                        for fc in unique_calls[MAX_TOOL_CALLS_PER_BATCH:]:
                                            func_responses.append(types.FunctionResponse(
                                                id=fc.id, name=fc.name,
                                                response={"status": "skipped", "reason": "batch limit reached"},
                                            ))
                                        unique_calls = unique_calls[:MAX_TOOL_CALLS_PER_BATCH]
                                    calls = unique_calls
                                    any_executed = False  # Track if any tool actually ran

                                    # Reset rejection counts when user says something new
                                    if transcript != rejection_transcript:
                                        rejection_counts.clear()
                                        rejection_transcript = transcript

                                    for fc in calls:
                                        # Retry cap: stop infinite rejection loops
                                        rkey = f"{fc.name}:{sorted((fc.args or {}).items())}"
                                        if rejection_counts.get(rkey, 0) >= MAX_REJECTIONS:
                                            slog.info("RETRY CAP: %s(%s) rejected %d times — hard stop [transcript: %s]",
                                                      fc.name, fc.args, MAX_REJECTIONS, transcript[:100])
                                            func_responses.append(types.FunctionResponse(
                                                id=fc.id,
                                                name=fc.name,
                                                response={"status": "error", "reason": f"This action failed validation {MAX_REJECTIONS} times. Do not retry. Tell the user you couldn't complete this action."},
                                            ))
                                            continue

                                        allowed, reason = validate_tool_call(
                                            fc.name, fc.args or {}, transcript
                                        )
                                        if not allowed:
                                            rejection_counts[rkey] = rejection_counts.get(rkey, 0) + 1
                                            slog.info("VALIDATION REJECTED: %s(%s) — %s [transcript: %s] (attempt %d/%d)",
                                                      fc.name, fc.args, reason, transcript[:100],
                                                      rejection_counts[rkey], MAX_REJECTIONS)
                                            func_responses.append(types.FunctionResponse(
                                                id=fc.id,
                                                name=fc.name,
                                                response={"status": "skipped", "reason": reason},
                                            ))
                                            continue

                                        slog.debug("VALIDATION PASSED: %s(%s) — %s", fc.name, fc.args, reason)
                                        any_executed = True
                                        t0 = time.monotonic()
                                        result = await asyncio.to_thread(
                                            dispatch_tool_call, tool_state, fc.name, fc.args or {}
                                        )
                                        elapsed_ms = (time.monotonic() - t0) * 1000
                                        slog.info("Tool result: %s → %s (%.1fms)", fc.name, result, elapsed_ms)
                                        func_responses.append(types.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response=result,
                                        ))

                                    if func_responses:
                                        await session.send_tool_response(
                                            function_responses=func_responses,
                                        )
                                        slog.info("Tool responses sent (%d, %d executed)", len(func_responses), int(any_executed))
                                        # Arm double-talk gate
                                        if any_executed:
                                            # Successful tool execution: give model one speaking turn
                                            post_tool_turn_gate = True
                                            block_extra_turns = False
                                        else:
                                            # All rejected/error: arm gate if not already blocked, but don't unblock
                                            if not block_extra_turns:
                                                post_tool_turn_gate = True

                                    # Safety embedding: inject preference context after preference updates
                                    # so avoidances survive long conversations
                                    had_pref_update = any(
                                        fc.name == "update_user_preference" for fc in calls
                                    )
                                    if had_pref_update and tool_state.preferences:
                                        pref_msg = _format_pref_injection(tool_state.preferences)
                                        await session.send_client_content(
                                            turns=types.Content(
                                                role="user",
                                                parts=[types.Part(text=pref_msg)],
                                            ),
                                            turn_complete=False,
                                        )
                                        slog.info("Preference context injected: %s", pref_msg)

                                    # Persist preferences so they survive Gemini crashes
                                    if tool_state.preferences:
                                        _saved_preferences[user_id] = (dict(tool_state.preferences), time.time())
                                    else:
                                        _saved_preferences.pop(user_id, None)

                                # Start or reset the buffer timer
                                if tool_buffer_task and not tool_buffer_task.done():
                                    tool_buffer_task.cancel()
                                tool_buffer_task = asyncio.create_task(_flush_tool_buffer())
                                continue

                            # ── Session resumption handle capture ──
                            if getattr(response, 'session_resumption_update', None):
                                update = response.session_resumption_update
                                new_handle = getattr(update, 'new_handle', None)
                                if new_handle:
                                    _resume_handles[user_id] = (new_handle, time.time())
                                    # Prune handles older than 24 hours
                                    now = time.time()
                                    expired = [uid for uid, (_, ts) in _resume_handles.items()
                                               if now - ts > _RESUME_HANDLE_MAX_AGE]
                                    for uid in expired:
                                        del _resume_handles[uid]
                                    if expired:
                                        slog.debug("Pruned %d expired resume handles", len(expired))
                                    # Prune stale saved preferences too
                                    expired_prefs = [uid for uid, (_, ts) in _saved_preferences.items()
                                                     if now - ts > _RESUME_HANDLE_MAX_AGE]
                                    for uid in expired_prefs:
                                        del _saved_preferences[uid]
                                    slog.debug("Session resumption handle captured")

                            # ── GoAway: connection ending soon ──
                            if getattr(response, 'go_away', None):
                                time_left = getattr(response.go_away, 'time_left', '?')
                                slog.info("GoAway received — connection ending in %s", time_left)

                            # ── Tool call cancellation ──
                            if response.tool_call_cancellation:
                                slog.info("Tool call cancelled: %s",
                                          response.tool_call_cancellation)

                            # ── Audio data ──
                            sc = response.server_content
                            client_dead = False
                            if sc and sc.model_turn and sc.model_turn.parts:
                                # Double-talk gate: safety valve auto-clear
                                if block_extra_turns and (time.time() - gate_set_time > GATE_TIMEOUT):
                                    slog.info("Double-talk gate auto-cleared (%.0fs safety valve)", GATE_TIMEOUT)
                                    block_extra_turns = False
                                # Double-talk gate: suppress duplicate audio
                                if block_extra_turns:
                                    slog.info("Double-talk gate: suppressed model audio (no user speech since tool response)")
                                    continue  # Skip forwarding this audio
                                for part in sc.model_turn.parts:
                                    if part.inline_data and part.inline_data.mime_type and part.inline_data.mime_type.startswith("audio/"):
                                        audio_b64 = base64.b64encode(part.inline_data.data).decode("ascii")
                                        if not await _safe_send(websocket, {
                                            "content": {
                                                "parts": [{
                                                    "inline_data": {
                                                        "mime_type": part.inline_data.mime_type,
                                                        "data": audio_b64,
                                                    }
                                                }]
                                            }
                                        }, slog):
                                            client_dead = True
                                            break
                            if client_dead:
                                break

                            # Accumulate transcriptions (eagerly update for validation)
                            if sc and sc.input_transcription and sc.input_transcription.text:
                                # User spoke — clear double-talk gate
                                if block_extra_turns:
                                    slog.debug("Double-talk gate cleared (user spoke)")
                                    block_extra_turns = False
                                post_tool_turn_gate = False
                                user_transcript.append(sc.input_transcription.text)
                                last_user_transcription = "".join(user_transcript)

                            if sc and sc.output_transcription and sc.output_transcription.text:
                                mia_transcript.append(sc.output_transcription.text)

                            # Turn complete — flush transcripts + arm double-talk gate
                            if sc and sc.turn_complete:
                                if user_transcript:
                                    last_user_transcription = "".join(user_transcript)
                                    slog.info("User: %s", last_user_transcription)
                                    user_transcript.clear()
                                if mia_transcript:
                                    slog.info("Mia: %s", "".join(mia_transcript))
                                    mia_transcript.clear()
                                slog.debug("Turn complete (msg #%d)", msg_count)
                                # Double-talk gate: first post-tool turn done → block extras
                                if post_tool_turn_gate:
                                    post_tool_turn_gate = False
                                    block_extra_turns = True
                                    gate_set_time = time.time()
                                    slog.debug("Double-talk gate armed (first post-tool turn complete)")

                            # Interruption (barge-in) — flush transcripts + clear gate
                            if sc and sc.interrupted:
                                if user_transcript:
                                    last_user_transcription = "".join(user_transcript)
                                    slog.info("User: %s", last_user_transcription)
                                    user_transcript.clear()
                                if mia_transcript:
                                    slog.info("Mia: %s (interrupted)", "".join(mia_transcript))
                                    mia_transcript.clear()
                                slog.debug("Interrupted (msg #%d)", msg_count)
                                await _safe_send(websocket, {"interrupted": True}, slog)
                                # Clear double-talk gate on interruption
                                block_extra_turns = False
                                post_tool_turn_gate = False

                            # ── Periodic system instruction update (compression-proof) ──
                            # System instructions survive compression (never discarded).
                            # Re-inject preferences + timer state every 5 min so they persist
                            # even after oldest conversation turns are trimmed.
                            now = time.time()
                            if now - last_reinforce_time > REINFORCE_INTERVAL:
                                state_parts = []
                                if tool_state.preferences:
                                    state_parts.append(_format_pref_injection(tool_state.preferences))
                                active_timers = []
                                for t in tool_state.active_timers.values():
                                    remaining = max(0, int(t["duration_seconds"] - (now - t["set_at"]))) if not t.get("paused") else t.get("remaining_when_paused", 0)
                                    active_timers.append((t["label"], remaining))
                                if active_timers:
                                    timer_str = ", ".join(f"{l} ({r}s)" for l, r in active_timers)
                                    state_parts.append(f"Active timers: {timer_str}")
                                if state_parts:
                                    try:
                                        await session.send_client_content(
                                            turns=types.Content(
                                                role="user",
                                                parts=[types.Part(text=(
                                                    f"[State update — {' '.join(state_parts)}]"
                                                ))],
                                            ),
                                            turn_complete=False,
                                        )
                                        slog.info("System instruction update: %s", "; ".join(state_parts))
                                    except Exception:
                                        slog.debug("System instruction update failed (non-critical)")
                                last_reinforce_time = now

                        slog.debug("session.receive() iterator ended after %d messages, re-entering", msg_count)

                    # If we broke out due to max re-entries, notify frontend
                    await _safe_send(websocket, {"type": "gemini_disconnected"}, slog)

                except WebSocketDisconnect:
                    slog.info("Client disconnected (downstream)")
                except Exception:
                    slog.exception("Downstream error")
                    await _safe_send(websocket, {"type": "gemini_disconnected"}, slog)

            async def event_forwarder():
                """Forward tool events (timer_set, preference_updated, etc.) to the browser."""
                try:
                    while True:
                        event = await event_queue.get()
                        if not await _safe_send(websocket, event, slog):
                            break
                        slog.debug("Event forwarded: %s", event.get("type"))
                except asyncio.CancelledError:
                    pass
                except Exception:
                    slog.exception("Event forwarder error")

            up = asyncio.create_task(upstream())
            down = asyncio.create_task(downstream())
            fwd = asyncio.create_task(event_forwarder())
            done, pending = await asyncio.wait(
                [up, down, fwd], return_when=asyncio.FIRST_COMPLETED
            )
            finished_names = [
                "upstream" if t is up else "downstream" if t is down else "event_forwarder"
                for t in done
            ]
            slog.info("First task finished: %s", finished_names)
            for task in pending:
                task.cancel()

            # Crash vs clean disconnect detection:
            # upstream finished first → user disconnected (clean Stop) → clear saved state
            # downstream finished first → Gemini died (crash) → preserve state for reconnect
            clean_disconnect = up in done
            if clean_disconnect:
                _saved_preferences.pop(user_id, None)
                _resume_handles.pop(user_id, None)
                slog.info("Clean disconnect — cleared saved state for user %s", user_id)
            else:
                slog.info("Crash disconnect — preserving state for user %s", user_id)

    except Exception:
        slog.exception("Session setup error")
    finally:
        slog.info("Session ended")
        logger.info("Session ended: %s", session_id)
