import asyncio
import base64
import json
import logging
import os
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

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from google import genai
from google.genai import types

from tools import (
    get_tool_declarations,
    dispatch_tool_call,
    SessionToolState,
    validate_tool_call,
)

# ── Per-user state that survives WebSocket reconnects ──
# Connection lifetime is ~10 min; handles are valid ~24 hours on Vertex.
# Resume handles: stored by user_id so reconnecting clients resume with preserved context.
_resume_handles: dict[str, str] = {}
# Saved preferences: keyed by user_id, persisted across Gemini crashes so allergies
# aren't lost when the connection resets. Cleared on clean disconnect (user clicks Stop).
_saved_preferences: dict[str, dict[str, str]] = {}

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
You are Mia, a knowledgeable friend who happens to be a great cook.
Keep responses around 5 to 35 words. Casual, practical, a little funny.
Ask what they're cooking. Help them cook. Say goodbye when done.
When camera is on, use what you see to help:
- Comment on cooking progress ("that's nicely browned", "flip it soon")
- Warn about safety: smoking oil, raw meat near other food, burner too high
- Don't narrate everything — only speak up when it adds value
When no camera is active, you're audio only.

You have tools available:
- update_user_preference: Save user preferences (allergies, dietary restrictions, skill level, serving size).
- manage_timer: Set, cancel, pause, resume, or adjust cooking timers.
You have built-in Google Search — use it when the user asks factual questions you're not 100% sure about (temperatures, substitutions, food safety, recipes). Be concise with search answers — include specific numbers.

Only use tools when the user explicitly asks for something related to that tool.
When multiple tool results come back, respond once covering everything.
"""

# ── App setup ───────────────────────────────────────────────

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4173",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Stub endpoints ──────────────────────────────────────────

class VerifyCodeRequest(BaseModel):
    code: str = ""


@app.post("/api/verify-code")
async def verify_code(req: VerifyCodeRequest):
    return {"valid": True}


@app.post("/api/frontend-logs")
async def frontend_logs():
    return {"ok": True}


# ── WebSocket endpoint ──────────────────────────────────────

@app.websocket("/ws/{user_id}/{session_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str, session_id: str):
    await websocket.accept()
    logger.info("Connected: user=%s session=%s", user_id, session_id)
    slog = _create_session_logger(session_id)
    slog.info("Connected: user=%s session=%s", user_id, session_id)

    # Per-session state: event queue + tool state
    event_queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    tool_state = SessionToolState(event_queue)

    # Check for a stored resumption handle from a previous connection
    resume_handle = _resume_handles.get(user_id)
    is_resuming = resume_handle is not None

    # Restore preferences from a previous session (survives Gemini crashes)
    # so allergies/dietary info aren't lost on reconnect
    if is_resuming:
        saved = _saved_preferences.get(user_id)
        if saved:
            try:
                tool_state.preferences = dict(saved)
                # Re-emit preference events so frontend chips appear
                for key, value in tool_state.preferences.items():
                    tool_state.emit({"type": "preference_updated", "key": key, "value": value})
                slog.info("Restored %d preferences for user %s: %s",
                          len(saved), user_id, saved)
            except Exception:
                slog.warning("Failed to restore preferences — starting fresh")

    config = types.LiveConnectConfig(
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

                        # Input size cap (skip audio — it's binary, always small)
                        if len(raw) > MAX_MESSAGE_LEN:
                            try:
                                peek = json.loads(raw[:100] + "}")
                            except Exception:
                                peek = {}
                            if peek.get("type") not in ("audio", "image"):
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
                                media=types.Blob(
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
                            await session.send_realtime_input(
                                media=types.Blob(
                                    data=image_bytes,
                                    mime_type="image/jpeg",
                                )
                            )
                            slog.debug("Upstream: image frame (%d bytes)", len(image_bytes))

                        elif msg_type == "timer_expired":
                            timer_id = msg.get("timer_id", "")
                            label = msg.get("label", "timer")
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
                                try:
                                    await websocket.send_text(json.dumps({"type": "ready"}))
                                    slog.info("Ready signal sent")
                                except RuntimeError:
                                    pass

                            # ── Tool calls (buffered + validated) ──
                            if response.tool_call:
                                fc_list = response.tool_call.function_calls or []
                                slog.info("Tool call received: %d function(s): %s",
                                          len(fc_list),
                                          [fc.name for fc in fc_list])
                                pending_tool_calls.extend(fc_list)

                                async def _flush_tool_buffer():
                                    """Wait for buffer window, then validate + execute + respond."""
                                    nonlocal pending_tool_calls, tool_buffer_task
                                    await asyncio.sleep(TOOL_BUFFER_MS / 1000)
                                    calls = pending_tool_calls[:]
                                    pending_tool_calls.clear()
                                    tool_buffer_task = None
                                    if not calls:
                                        return

                                    transcript = last_user_transcription
                                    func_responses = []
                                    for fc in calls:
                                        allowed, reason = validate_tool_call(
                                            fc.name, fc.args or {}, transcript
                                        )
                                        if not allowed:
                                            slog.info("VALIDATION REJECTED: %s(%s) — %s [transcript: %s]",
                                                      fc.name, fc.args, reason, transcript[:100])
                                            func_responses.append(types.FunctionResponse(
                                                id=fc.id,
                                                name=fc.name,
                                                response={"status": "skipped", "reason": reason},
                                            ))
                                            continue

                                        slog.debug("VALIDATION PASSED: %s(%s) — %s", fc.name, fc.args, reason)
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
                                        slog.info("Tool responses sent (%d)", len(func_responses))

                                    # Safety embedding: inject preference context after preference updates
                                    # so allergies/dietary info survives long conversations
                                    had_pref_update = any(
                                        fc.name == "update_user_preference" for fc in calls
                                    )
                                    if had_pref_update and tool_state.preferences:
                                        pref_parts = "; ".join(
                                            f"{k}: {v}" for k, v in tool_state.preferences.items()
                                        )
                                        await session.send_client_content(
                                            turns=types.Content(
                                                role="user",
                                                parts=[types.Part(text=(
                                                    f"[User preferences — {pref_parts}. "
                                                    "Always respect these, especially allergies.]"
                                                ))],
                                            ),
                                            turn_complete=False,
                                        )
                                        slog.info("Preference context injected: %s", pref_parts)

                                    # Persist preferences so they survive Gemini crashes
                                    if tool_state.preferences:
                                        _saved_preferences[user_id] = dict(tool_state.preferences)
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
                                    _resume_handles[user_id] = new_handle
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
                            if sc and sc.model_turn and sc.model_turn.parts:
                                for part in sc.model_turn.parts:
                                    if part.inline_data and part.inline_data.mime_type and part.inline_data.mime_type.startswith("audio/"):
                                        audio_b64 = base64.b64encode(part.inline_data.data).decode("ascii")
                                        await websocket.send_text(json.dumps({
                                            "content": {
                                                "parts": [{
                                                    "inline_data": {
                                                        "mime_type": part.inline_data.mime_type,
                                                        "data": audio_b64,
                                                    }
                                                }]
                                            }
                                        }))

                            # Accumulate transcriptions (eagerly update for validation)
                            if sc and sc.input_transcription and sc.input_transcription.text:
                                user_transcript.append(sc.input_transcription.text)
                                last_user_transcription = "".join(user_transcript)

                            if sc and sc.output_transcription and sc.output_transcription.text:
                                mia_transcript.append(sc.output_transcription.text)

                            # Turn complete — flush transcripts
                            if sc and sc.turn_complete:
                                if user_transcript:
                                    last_user_transcription = "".join(user_transcript)
                                    slog.info("User: %s", last_user_transcription)
                                    user_transcript.clear()
                                if mia_transcript:
                                    slog.info("Mia: %s", "".join(mia_transcript))
                                    mia_transcript.clear()
                                slog.debug("Turn complete (msg #%d)", msg_count)

                            # Interruption (barge-in) — flush transcripts
                            if sc and sc.interrupted:
                                if user_transcript:
                                    last_user_transcription = "".join(user_transcript)
                                    slog.info("User: %s", last_user_transcription)
                                    user_transcript.clear()
                                if mia_transcript:
                                    slog.info("Mia: %s (interrupted)", "".join(mia_transcript))
                                    mia_transcript.clear()
                                slog.debug("Interrupted (msg #%d)", msg_count)
                                try:
                                    await websocket.send_text(json.dumps({"interrupted": True}))
                                except RuntimeError:
                                    pass

                            # ── Periodic system instruction update (compression-proof) ──
                            # System instructions survive compression (never discarded).
                            # Re-inject preferences + timer state every 5 min so they persist
                            # even after oldest conversation turns are trimmed.
                            now = time.time()
                            if now - last_reinforce_time > REINFORCE_INTERVAL:
                                state_parts = []
                                if tool_state.preferences:
                                    pref_str = "; ".join(
                                        f"{k}: {v}" for k, v in tool_state.preferences.items()
                                    )
                                    state_parts.append(f"User preferences: {pref_str}")
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
                                                role="system",
                                                parts=[types.Part(text=(
                                                    f"[State update — {'. '.join(state_parts)}. "
                                                    "Always respect allergies and dietary restrictions.]"
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
                    try:
                        await websocket.send_text(json.dumps({"type": "gemini_disconnected"}))
                    except Exception:
                        pass

                except WebSocketDisconnect:
                    slog.info("Client disconnected (downstream)")
                except Exception:
                    slog.exception("Downstream error")
                    try:
                        await websocket.send_text(json.dumps({"type": "gemini_disconnected"}))
                    except Exception:
                        pass

            async def event_forwarder():
                """Forward tool events (timer_set, preference_updated, etc.) to the browser."""
                try:
                    while True:
                        event = await event_queue.get()
                        try:
                            await websocket.send_text(json.dumps(event))
                            slog.debug("Event forwarded: %s", event.get("type"))
                        except RuntimeError:
                            break
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
