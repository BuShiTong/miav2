# Mia — Voice Cooking Assistant (v2)

Real-time voice cooking assistant built on Google's Gemini Live API with native audio.

## Current State

Migration to Vertex AI is **complete**. The app is functional with:
- Native audio model (`gemini-live-2.5-flash-native-audio`)
- `enable_affective_dialog` (model reacts to user tone)
- Server-side tool call validation layer (prevents hallucinated preferences and autonomous actions)
- Tool call buffering (300ms, batches multiple calls)
- Timer deduplication (prevents duplicate timers)
- Context window compression (100K trigger, 80K target — prevents token overflow in long sessions)
- Session resumption (preserves context across ~10 min connection resets, handles valid ~24h)
- Periodic system instruction updates (compression-proof state: allergies + timers survive trimming)
- GoAway handling (60s warning before connection terminates)

## Known Limitation

Vertex AI **strips the BLOCKING/SILENT parameters** from its protobuf — the model never sees them. This means the model may occasionally "double-talk" (speak before AND after a tool call). This is a known Vertex AI bug.

**Our approach:** Instead of trying to filter audio (the audio gate was tried and removed — it caused garbled fragments), we use **server-side validation**:
- Tool calls are checked against the user's actual speech (transcription) before executing
- Bad calls (hallucinated preferences, autonomous timer actions) are silently rejected
- The model gets `{"status": "skipped"}` and moves on without telling the user

See `decisions.md` for the full history of approaches tried (Decisions #19, #24, #26, #27).

## Architecture

- `backend/main.py` — FastAPI server, WebSocket endpoint, Gemini Live API session, tool call buffering
- `backend/tools.py` — Tool declarations, dispatch, validation layer (`validate_tool_call`)
- `frontend/` — Browser UI with audio capture/playback, camera, timer display
- `purrfect-hopping-tulip.md` — Reference doc listing every custom mechanism and why it exists

## Key Files

| File | What to modify for... |
|------|----------------------|
| `backend/main.py` | System prompt, session config, buffering logic |
| `backend/tools.py` | Tool functions, validation keywords, tool declarations |
| `backend/.env` | Vertex AI credentials (project, location, model) |
| `decisions.md` | Logging new architectural decisions |
| `testing-checklist.md` | Adding new test cases |

## Rules

- Always read files before modifying them
- Check Context7 for library docs before writing SDK code
- Test each change before moving to the next task
- If `enable_affective_dialog` gets rejected by the API, just remove it — don't debug, it's a known issue
- Focus on programmatic controls (server-side validation, input validation) over prompt engineering
