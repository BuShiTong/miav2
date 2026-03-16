# Mia: Your Voice Cooking Assistant

A real-time voice assistant that talks you through recipes, watches your cooking via camera, and actually listens when you interrupt.

## What is Mia

Mia is a hands-free cooking companion built on the Gemini Live API with native audio. You talk, she talks back; no typing, no text-to-speech. She remembers your allergies, sets timers, looks at your pan through the camera, and pulls nutrition info from Google Search. Built for the Gemini Live Agent Challenge hackathon.

## Features

- **Real-time voice conversation**: native audio streaming, not synthesized speech
- **Barge-in**: interrupt Mia mid-sentence, she stops and listens
- **Allergy and preference memory**: tell her once, she remembers (even across reconnects)
- **Cooking timers**: voice-controlled with visual countdown and audible beep
- **Live camera vision**: point your phone at the pan, get feedback on what she sees
- **Google Search grounding**: nutrition facts, ingredient substitutions, sourced from the web
- **Affective dialog**: responds to your tone (frustrated, excited, confused)
- **Long session support**: context window compression keeps things stable over extended cooking sessions

## Architecture

```
Browser (React)
    |
    | WebSocket (audio + messages)
    |
FastAPI Backend
    |  - Tool call dispatch (timers, preferences, camera, search)
    |  - Audio routing
    |  - Context window compression
    |  - Session resumption
    |  - Server-side tool validation
    |
Gemini Live API (Vertex AI)
    gemini-live-2.5-flash-native-audio
```

Audio flows both directions over a single WebSocket. The backend sits between the browser and Gemini, handling tool calls, validating requests, and managing session state. No database; everything lives in memory for the duration of the session.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite |
| Audio | Web Audio API with AudioWorklet processors |
| Backend | Python, FastAPI, WebSocket |
| AI | Gemini Live API via Vertex AI |
| SDK | google-genai (Python) |
| Deployment | Google Cloud Run |

## Quick Start (Local Development)

### Prerequisites

- Python 3.11+
- Node.js 18+
- A Google Cloud project with the Vertex AI API enabled
- `gcloud` CLI installed and authenticated

### 1. Clone the repo

```bash
git clone https://github.com/BuShiTong/miav2.git
cd miav2
```

### 2. Backend setup

```bash
cd backend
pip install -r requirements.txt
```

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your Google Cloud project ID and location. Then authenticate:

```bash
gcloud auth application-default login
```

Start the backend:

```bash
uvicorn main:app --host 0.0.0.0 --port 8080
```

### 3. Frontend setup

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

### 4. Open the app

Go to `https://localhost:5173` in your browser. You will need to accept the self-signed certificate (the app requires HTTPS for microphone access).

Enter the access code `cookwithmia26` when prompted, allow microphone access, and start talking.

## Cloud Run Deployment

Build and deploy from the project root:

```bash
gcloud run deploy mia-backend --source ./backend --region us-central1 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=your-project,GOOGLE_CLOUD_LOCATION=us-central1,GEMINI_MODEL=gemini-live-2.5-flash-native-audio,ACCESS_CODE=cookwithmia26"
```

For the frontend, build and deploy similarly or serve the static build from any CDN. Set the `CORS_ORIGINS` env var on the backend to match your frontend URL.

## How It Works

**Context window compression**: When the conversation hits 100K tokens, the backend compresses it down to ~80K by summarizing older turns. This prevents crashes during long cooking sessions without losing important context like allergies and active timers.

**Server-side tool validation**: The model occasionally hallucinates tool calls (a known Vertex AI quirk). The backend checks every tool call against what the user actually said. Bad calls get silently rejected, the user never notices.

**Session resumption**: Vertex AI connections drop after ~10 minutes. The backend stores resume tokens so it can pick up where it left off. Your allergies and conversation context survive the reconnect.

**Tool call buffering**: Tool calls arrive in bursts. A 300ms batching window collects them before processing, which prevents duplicate timers and redundant operations.

**Voice-controlled camera**: Say "turn on the camera" or "flip the camera" and Mia controls it via tool calls. The video feed is input-only; she can see what you show her, but there is no video output from the model.

## License

Built for the Gemini Live Agent Challenge hackathon.
