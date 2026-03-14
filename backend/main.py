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
    search_web,
    SessionToolState,
    ASYNC_TOOLS,
)

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
You can see the user's cooking area through their camera when they enable it. Comment on what you see when useful.
When no camera is active, you're audio only.

You have tools available:
- update_user_preference: Save user preferences (allergies, dietary restrictions, skill level, serving size). Use this when the user mentions any preference.
- manage_timer: Set, cancel, pause, resume, adjust, or check cooking timers.
- search_web: Search the web for cooking facts, food safety info, recipes, or substitutions. Use this when you're not 100% sure about a factual answer (temperatures, times, food safety).

CRITICAL TOOL BEHAVIOR RULES:
- For update_user_preference and manage_timer: Call the tool IMMEDIATELY without saying anything first. Do NOT narrate what you are about to do. Only speak AFTER you receive the tool result.
- For search_web: You MUST say a brief filler like "let me check on that" or "one sec" FIRST, then call the tool. Never call search_web without speaking first. After the result comes back, give a concise answer.
- Never narrate what you are about to do before a tool call. Never say "let me save that" or "I'll set a timer" — just call the tool silently.
- Never repeat yourself after receiving a tool result.
- When multiple tool results come back at once, acknowledge ALL of them in one single combined response.
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
    )

    try:
        async with client.aio.live.connect(model=MODEL, config=config) as session:
            slog.info("Live session opened: model=%s", MODEL)

            # Pre-warm: trigger Mia's greeting
            await session.send_client_content(
                turns=types.Content(
                    role="user",
                    parts=[types.Part(text="[Session started — greet the user and ask what they're cooking]")],
                ),
                turn_complete=True,
            )
            slog.debug("Greeting sent")

            async def upstream():
                """Browser → Gemini: forward audio, video frames, and timer events."""
                audio_count = 0
                last_image_time = 0.0
                try:
                    while True:
                        raw = await websocket.receive_text()
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
                            if audio_count % 50 == 1:
                                slog.debug("Upstream: audio chunk #%d (%d bytes)", audio_count, len(audio_bytes))

                        elif msg_type == "image":
                            now = time.time()
                            if now - last_image_time < 1.0:
                                continue
                            last_image_time = now
                            try:
                                image_bytes = base64.b64decode(msg.get("data", ""))
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
                try:
                    slog.debug("Downstream: starting receive loop")
                    while True:
                        async for response in session.receive():
                            msg_count += 1

                            if not ready_sent:
                                ready_sent = True
                                try:
                                    await websocket.send_text(json.dumps({"type": "ready"}))
                                    slog.info("Ready signal sent")
                                except RuntimeError:
                                    pass

                            # ── Tool calls ──
                            if response.tool_call:
                                fc_list = response.tool_call.function_calls or []
                                slog.info("Tool call received: %d function(s): %s",
                                          len(fc_list),
                                          [fc.name for fc in fc_list])

                                async def _run_tool(fc):
                                    t0 = time.monotonic()
                                    if fc.name in ASYNC_TOOLS:
                                        result = await search_web(
                                            tool_state, **(fc.args or {}),
                                            search_client=client,
                                        )
                                    else:
                                        result = await asyncio.to_thread(
                                            dispatch_tool_call, tool_state, fc.name, fc.args or {}
                                        )
                                    elapsed_ms = (time.monotonic() - t0) * 1000
                                    slog.info("Tool result: %s → %s (%.1fms)", fc.name, result, elapsed_ms)
                                    return types.FunctionResponse(
                                        id=fc.id,
                                        name=fc.name,
                                        response=result,
                                    )

                                responses = await asyncio.gather(
                                    *[_run_tool(fc) for fc in fc_list]
                                )

                                await session.send_tool_response(
                                    function_responses=list(responses),
                                )
                                slog.info("Tool responses sent (%d)", len(responses))
                                continue

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

                            # Accumulate transcriptions
                            if sc and sc.input_transcription and sc.input_transcription.text:
                                user_transcript.append(sc.input_transcription.text)

                            if sc and sc.output_transcription and sc.output_transcription.text:
                                mia_transcript.append(sc.output_transcription.text)

                            # Turn complete — flush transcripts
                            if sc and sc.turn_complete:
                                if user_transcript:
                                    slog.info("User: %s", "".join(user_transcript))
                                    user_transcript.clear()
                                if mia_transcript:
                                    slog.info("Mia: %s", "".join(mia_transcript))
                                    mia_transcript.clear()
                                slog.debug("Turn complete (msg #%d)", msg_count)

                            # Interruption (barge-in) — flush transcripts
                            if sc and sc.interrupted:
                                if user_transcript:
                                    slog.info("User: %s", "".join(user_transcript))
                                    user_transcript.clear()
                                if mia_transcript:
                                    slog.info("Mia: %s (interrupted)", "".join(mia_transcript))
                                    mia_transcript.clear()
                                slog.debug("Interrupted (msg #%d)", msg_count)
                                try:
                                    await websocket.send_text(json.dumps({"interrupted": True}))
                                except RuntimeError:
                                    pass

                        slog.debug("session.receive() iterator ended after %d messages, re-entering", msg_count)

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

    except Exception:
        slog.exception("Session setup error")
    finally:
        slog.info("Session ended")
        logger.info("Session ended: %s", session_id)
