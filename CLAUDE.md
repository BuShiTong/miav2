# Mia — Vertex AI Version

This is the **Vertex AI fork** of Mia, a real-time voice cooking assistant built on Google's Gemini Live API.

The original version (in `../Mia`) uses Google AI Studio. This version uses Vertex AI for:
- More natural voice (native audio model)
- `enable_affective_dialog` support (model reacts to user tone)
- `proactivity` support (smarter response timing)

## Current State

This is a copy of the AI Studio version. It needs to be migrated to Vertex AI.
See `vertex-migration-plan.md` for the complete plan with research, workarounds, and tasks.

## Key Constraint

Vertex AI has a **known bug** where the native audio model keeps talking after a tool call instead of pausing. The `BLOCKING` behavior and `SILENT` scheduling parameters that fix this on AI Studio are **stripped by Vertex AI's protobuf** — the model never sees them.

**Our workaround:** System prompt discipline + client-side audio gate. See the migration plan for full details.

## Architecture

- `backend/main.py` — FastAPI server, WebSocket endpoint, Gemini Live API session
- `backend/tools.py` — Tool declarations and dispatch (preferences, timers, web search)
- `frontend/` — Browser UI with audio capture/playback, camera, timer display

## Key Files to Modify

- `backend/main.py` — Auth, config, system prompt, audio gate
- `backend/tools.py` — Remove `behavior` param, update tool descriptions
- `.env` — Vertex AI credentials

## Rules

- Always read files before modifying them
- Check Context7 for library docs before writing SDK code
- Test each change before moving to the next task
- If `enable_affective_dialog` or `proactivity` get rejected by the API, just remove them — don't debug, it's a known issue
