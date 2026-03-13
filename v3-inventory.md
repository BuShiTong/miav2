# V3 Inventory: Everything Built On Top of ADK

Everything custom in v2, organized by category. Each item has a one-line description so you can decide keep/remove for v3.

---

## A. TOOLS (what the AI can call)

| # | Thing | What it does |
|---|-------|-------------|
| A1 | `manage_timer` tool | Single consolidated timer tool with 9 actions (set, cancel, pause, resume, adjust, restart, hide, show, status) — consolidated from 8 separate tools because too many similar tools made the model call none of them |
| A2 | `update_user_preference` tool | Saves user preferences (allergies, dietary, skill level, serving size) to session state |
| A3 | `GoogleSearchAgentTool` (sub-agent) | Wraps a separate `gemini-2.5-flash-lite` agent that does Google Search — because the native audio model can't use `generateContent` API and can't have built-in tools mixed with function tools |
| A4 | `PreloadMemoryTool` | Auto-executed before each LLM request — searches past session memory and injects relevant context. Not visible to the model (doesn't count toward tool limit) |
| A5 | `before_tool_callback` (`log_tool_call`) | Intercepts ALL tool calls before execution — logs them, emits `search_started` events, deduplicates searches within 10s, and intercepts preference saves to return `{}` instead of actually executing |
| A6 | `_format_duration()` helper | Converts seconds to human-readable strings ("5 minutes", "2m 30s") with proper singular/plural — used in tool responses |
| A7 | `_find_timer()` flexible lookup | Searches timers by label with toggleable filters for paused/expired/running states, returns soonest-expiring match if multiple |

---

## B. WORKAROUNDS FOR GEMINI BUGS

| # | Thing | What it does |
|---|-------|-------------|
| B1 | Empty response for preferences (`{}`) | Preference tool returns empty dict to prevent Gemini from restarting its audio response (causes duplicate/triple audio when it gets a real response) |
| B2 | Function-response audio gate | After ANY tool call, suppresses duplicate audio turns for 2.5 seconds — Gemini generates 2-3 separate audio responses after `function_response` |
| B3 | No explicit VAD config | Leaving `realtime_input_config` empty because adding explicit VAD parameters makes the model stop detecting barge-in entirely |
| B4 | `support_cfc=False` | Disabled because Vertex AI model names (`gemini-live-*`) fail ADK's CFC prefix check (`gemini-2` required) |
| B5 | Search dedup (10s window) | Caches identical search requests within 10 seconds because Gemini sometimes searches for the same thing twice |
| B6 | Timer cancel returns success for not-found | Returns "cancelled" instead of "error" for missing timers — prevents the model from retrying the same cancel 6+ times |
| B7 | Output transcription `<ctrl\d+>` filter | Strips native audio model control tokens that leak into text transcription |
| B8 | Separate model for sub-agent | Search sub-agent MUST use `gemini-2.5-flash-lite` because the native audio model only supports Live API, not `generateContent` |
| B9 | Max 3-5 tools total | Keeping tool count low because too many similar tools causes the model to call none of them |
| B10 | "MUST" language in prompts | Decision trees with "unmistakably MUST" language because soft prompt language gets ignored for tool calling (~71.5% compliance) |
| B11 | WRONG/RIGHT examples in allergy prompt | Model sometimes says "added to preferences" without calling the tool — explicit negative example of this failure added to prompt |
| B12 | Don't early-return on `interrupted` | The ADK event with `interrupted: true` may also contain audio for the NEXT response — processing must continue |

---

## C. AUDIO PROCESSING

| #   | Thing                                  | What it does                                                                                                                                  |
| --- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Capture worklet (1600 samples/100ms)   | Buffers mic audio into 100ms chunks before sending — reduces WebSocket messages from 125/sec to 10/sec                                        |
| C2  | Playback worklet (1000 chunk queue)    | Queues audio for speaker output with 1000-chunk cap (~40s buffer) — Gemini sends audio in bursts faster than real-time                        |
| C3  | Barge-in: instant mute + queue flush   | When user speaks over AI, immediately mutes gain and clears playback queue (no setTimeout — race condition)                                   |
| C4  | `echoCancellation: false`              | Chrome's echo cancellation crushes mic signal ~500x during AI playback, even with headphones — breaks both client and server speech detection |
| C5  | Adaptive echo baseline (EMA)           | Exponential moving average of mic RMS during AI playback — speech must be 3x louder than baseline to trigger barge-in                         |
| C6  | `MIN_RMS_THRESHOLD` (0.015)            | Minimum speech detection threshold calibrated for `echoCancellation: false` — coupled to C4                                                   |
| C7  | Playback heartbeat (`playback_active`) | Worklet sends heartbeat every ~250ms while audio is queued — drives `isPlaying` state even after Gemini stops sending new chunks              |
| C8  | Silent GainNode (gain=0) on mic        | Connects mic worklet to speakers at zero gain — Chrome requires a connected audio graph but we don't want mic loopback                        |
| C9  | 24kHz playback / 16kHz capture         | Gemini receives at 16kHz but sends at 24kHz — AudioContext must match                                                                         |
| C10 | AnalyserNode (passive)                 | Sits in playback chain for frequency visualization — doesn't modify audio, just reads it                                                      |
| C11 | Tab visibility handling                | Suspends/resumes AudioContexts when tab switches (browser suspends them automatically but we need clean state)                                |
| C12 | Programmatic UI sounds                 | Connect tone (C5+E5 ascending), timer-set chirp (G5), timer beep (880Hz x3) — all via oscillators, no audio files                             |
| C13 | URL-safe base64 normalization          | Converts Gemini's `-`/`_` to standard `+`/`/` in audio base64 decode — silent compatibility fix                                               |
| C14 | Sound context auto-resume              | Calls `ctx.resume()` on suspended AudioContext to handle browser autoplay restrictions                                                        |

---

## D. BARGE-IN SYSTEM (backend)

| # | Thing | What it does |
|---|-------|-------------|
| D1 | Client `barge_in` message | Frontend sends barge-in signal when speech detected during AI playback |
| D2 | Backend audio gate (`barge_in_active`) | Drops all downstream audio events while gate is active |
| D3 | Gate clearing | Clears on: `turn_complete`, `input_transcription`, `interrupted`, or 5-second safety timeout |
| D4 | Auto-clear task tracking | Safety timeout task stored in `auto_clear_tasks` set with `add_done_callback(discard)` — prevents GC of fire-and-forget tasks |

---

## E. SESSION LIFECYCLE

| # | Thing | What it does |
|---|-------|-------------|
| E1 | Crash vs clean disconnect detection | If downstream exits before upstream = Gemini crashed (preserve state). If user clicks Stop = clean disconnect (clear everything) |
| E2 | Resume token capture | Captures `live_session_resumption_update.new_handle` from ADK events, stores with 60s TTL |
| E3 | Stable `user_id` across reconnects | `userIdRef` stays constant; only `session_id` changes on reconnect — backend uses user_id to find resume tokens and saved preferences |
| E4 | Preference persistence on crash | `_saved_preferences` dict keyed by user_id survives Gemini crashes — restored to new session on reconnect |
| E5 | Auto-reconnect with backoff | Exponential backoff (1.5s → 24s) with ±20% jitter, max 5 attempts |
| E6 | 10s connection timeout | Prevents stuck "Connecting..." if server never accepts |
| E7 | `session_kill` event | If event forwarder crashes, kills entire session to surface the error instead of silent feature death |
| E8 | Memory save on clean disconnect only | `memory_service.add_session_to_memory()` skipped on crash (partial data misleading) |
| E9 | Pre-warm greeting skip on resume | Skips "Hello" message when reconnecting after Gemini crash — avoids duplicate greeting |
| E10 | Background resume token cleanup | Async task runs every 60s, prunes expired tokens (>60s old) from `_resume_tokens` dict |

---

## F. CUSTOM EVENT SYSTEM (tools.py -> frontend)

| # | Thing | What it does |
|---|-------|-------------|
| F1 | `_emit()` + asyncio.Queue | Tools put events on a queue, `event_forwarder_task` reads and sends to WebSocket |
| F2 | `ready` event | Sent on first ADK event (not WS open) — triggers connect sound |
| F3 | `timer_*` events (8 types) | timer_set, timer_cancelled, timer_paused, timer_resumed, timer_adjusted, timer_restarted, timer_hidden, timer_shown |
| F4 | `search_started` / `search_complete` | Search lifecycle events for amber indicator |
| F5 | `preference_updated` | Preference chip display events |
| F6 | `gemini_disconnected` | Triggers auto-reconnect on frontend |
| F7 | Frontend event routing | `useWebSocket.ts` routes messages by type prefix to dedicated hooks (useTimers, useSearch, usePreferences) |

---

## G. TIMER SYSTEM (full state machine)

| # | Thing | What it does |
|---|-------|-------------|
| G1 | Server-side timer state (`TimerInfo` dataclass) | Tracks id, label, duration, targetTime, paused, expired, hidden, remainingWhenPaused |
| G2 | 9 timer actions | set, cancel, pause, resume, adjust, restart, hide, show, status |
| G3 | `label='all'` support | Bulk operations on cancel, hide, show, status |
| G4 | Max 3 active timers | Hard limit enforced server-side |
| G5 | Duration bounds (1s to 8h) | Validated server-side |
| G6 | Label sanitization | Regex strips special chars, max 50 chars — prevents prompt injection |
| G7 | Server-side label lookup | Backend looks up timer label from `_active_timers` on expiry instead of trusting client — prevents prompt injection |
| G8 | `mark_timer_expired()` | Marks expired timers so they don't count against the max limit forever |
| G9 | Frontend: drift-resistant countdown | Uses absolute `targetTime`, recalculates remaining from `targetTime - Date.now()` each tick |
| G10 | localStorage persistence | Saves after every state change (except TICK). Restores on page load with validation |
| G11 | Auto-remove after 10s | Expired timers auto-disappear after 10 seconds |
| G12 | `beepSessionActive` flag | Only beeps for timers created during active session — not for timers restored from localStorage |
| G13 | `status` action | Returns accurate remaining time from server — prevents model from hallucinating time values |
| G14 | Timer expiry haptic | `[100, 50, 100, 50, 100]` vibration pattern on expiry (separate from warning haptic `[50, 30, 50]` at ≤10s) |
| G15 | Auto-remove timeout cleanup | Cancels all pending auto-remove timeouts on hook unmount — prevents orphaned timers |

---

## H. PREFERENCE SYSTEM

| # | Thing | What it does |
|---|-------|-------------|
| H1 | 4 preference keys | allergies, dietary, skill_level, serving_size |
| H2 | Negation filtering | "none", "no", "clear", "no allergies" etc. = remove chip |
| H3 | Comma splitting + dedup | Gemini sends "nuts,shellfish" as one string — split, dedup, merge with existing |
| H4 | Empty response pattern | `before_tool_callback` intercepts, saves to state, returns `{}` — function body never executes |
| H5 | Per-user persistence | `_saved_preferences[user_id]` survives Gemini crashes for reconnect |
| H6 | Safety embedding in system prompt | Allergies/dietary read from session state and embedded directly in system instruction — never truncated by context compression |

---

## I. ADK CONFIGURATION (RunConfig & App wrapper)

| # | Thing | What it does |
|---|-------|-------------|
| I1 | BIDI streaming mode | Full-duplex audio (not SSE request-response) |
| I2 | `response_modalities=["AUDIO"]` | Model speaks instead of returning text |
| I3 | Voice: Aoede | Female voice selection |
| I4 | `proactive_audio=True` | Model decides when to speak (vision coaching, noise filtering) |
| I5 | `enable_affective_dialog=True` | Model detects emotions from voice tone and adapts responses |
| I6 | `tool_thread_pool_config` (4 workers) | Tools run in background threads — event loop stays responsive during 3-4s search calls |
| I7 | Context window compression | Sliding window at 100k tokens, target 80k (pure truncation, not summarization) |
| I8 | Events compaction (every 10 turns) | Summarizes old events via separate `generateContent` call to `gemini-2.5-flash-lite` with cooking-aware prompt |
| I9 | Context caching (1-hour TTL) | System instruction cached via `ContextCacheConfig` in App wrapper |
| I10 | `InMemoryMemoryService` | Stores past session summaries for cross-session context |
| I11 | `DatabaseSessionService` (optional) | SQLite persistence toggled via `SESSION_DB_PATH` env var |
| I12 | `custom_metadata` | user_id + session_id auto-attached to all ADK events |
| I13 | Error recovery callbacks | `on_model_error_callback` returns playful text fallbacks, `on_tool_error_callback` returns safety-aware messages |
| I14 | `SessionResumptionConfig` | Passes captured resume token on reconnect |
| I15 | App wrapper (not plain Runner) | Required for context caching + events compaction — `Runner(app=_app)` not `Runner(agent=...)` |

---

## J. PROMPT ENGINEERING

| # | Thing | What it does |
|---|-------|-------------|
| J1 | Mia character definition | "Friend who happens to be a great cook", casual tone, 5-35 word responses |
| J2 | Conversation flow state machine | 4 states: GREETING → GATHERING INFO → ACTIVE COOKING → WRAPPING UP with transition rules |
| J3 | Tool calling decision trees | Numbered rules with "unmistakably MUST" + "Do NOT call for:" for each tool |
| J4 | Few-shot examples (6 dialogues) | Concrete examples covering questions, recovery, frustration, unclear audio |
| J5 | "No X" allergy logic | "no nuts" = allergy to nuts. "no allergies" = don't save. Explicit decision tree |
| J6 | WRONG/RIGHT preference examples | Explicit negative example of saying "added" without calling the tool |
| J7 | Food safety guardrails | Known safe temperatures hardcoded, "NEVER guess", recommend meat thermometer |
| J8 | Search filler sentence | "You MUST say a natural filler sentence BEFORE calling google_search_agent" with varied examples |
| J9 | Pronunciation guide | IPA-like hints for French/foreign cooking terms |
| J10 | Dynamic instruction switching | `InstructionProvider` reads `camera_enabled` from state → audio-only vs vision instruction |
| J11 | Vision coaching structure | SAFETY (immediate) > COOKING (when relevant) > TIMING (with timers), visual confidence levels |
| J12 | Safety section embedding | Allergies/dietary injected into system prompt via `_build_safety_section()` — survives context truncation |
| J13 | Compaction summarizer prompt | Cooking-aware summary with explicit rule: "Never omit allergy, dietary, or food safety info" |
| J14 | Timer suggestion etiquette | Wait for user agreement before calling tool. Don't re-suggest if declined |

---

## K. LOGGING & OBSERVABILITY

| # | Thing | What it does |
|---|-------|-------------|
| K1 | JSON structured logging | Custom `_JsonFormatter` outputs JSONL with timestamp, source, level, module, message |
| K2 | Per-session log files | Each WebSocket session gets `logs/sessions/YYYY-MM-DD_HH-MM-SS.jsonl` with interleaved backend+frontend |
| K3 | Rotating backend log | `logs/backend.log` auto-rotates at 2MB, max 3 backups |
| K4 | Frontend log shipping | Batched flush to `/api/frontend-logs` every 3s + `sendBeacon` on page unload |
| K5 | Frontend log caps | 50 entries per batch, 1000 chars per message, 2MB image cap |
| K6 | Session auto-cleanup | Keeps last 20 session files |
| K7 | Silenced noisy loggers | websockets, google_adk, google_genai, httpcore, httpx, uvicorn.access → WARNING |
| K8 | SESSION_SUMMARY | Logged on disconnect: events, barge-ins, audio dropped, audio gated, searches, tokens, preferences |
| K9 | Periodic diagnostics | Every 50 events: barge-in count + audio drops. Every 5s: WebSocket message type counts |
| K10 | Tool call logging | All tool invocations logged with truncated args |
| K11 | Module-scoped frontend loggers | 11 loggers: App, WebSocket, AudioCapture, AudioPlayback, Timers, Search, Preferences, VideoCapture, WakeLock, ErrorBoundary, Logger |
| K12 | Log backup & cleanup on startup | Renames existing logs with timestamps, prunes old backups (max 5 frontend, 3 backend) on server start |
| K13 | Uvicorn log integration | File handler added to uvicorn/uvicorn.access/uvicorn.error loggers + `logging.captureWarnings(True)` |
| K14 | Logger buffer overflow protection | Drops oldest 100 entries when buffer exceeds 500 — prevents unbounded memory growth |
| K15 | Logger double-flush prevention | Tracks in-flight batch to prevent concurrent flushes, re-queues on failure so no entries are lost |
| K16 | Logger page-level session ID | `page_${timestamp}_${random}` for pre-WebSocket log correlation before real session ID is available |
| K17 | Frontend log concurrency lock | `_frontend_log_lock` prevents concurrent writes to session log file from batched frontend entries |

---

## L. RATE LIMITING & VALIDATION

| # | Thing | What it does |
|---|-------|-------------|
| L1 | Access code gate | Backend-validated with `hmac.compare_digest`, 5 failed attempts per IP per 60s |
| L2 | Image frame rate limit | Server-side: max 1 frame/sec |
| L3 | Image size cap | Reject > 2MB base64 |
| L4 | Text message length cap | 10,000 chars max |
| L5 | Event queue maxsize | 1000 events, drop-on-full |
| L6 | WebSocket send timeout | All sends wrapped in `asyncio.wait_for(..., timeout=5.0)` |
| L7 | Frontend log batch cap | 50 entries max per batch |

---

## M. UI FEATURES

| # | Thing | What it does |
|---|-------|-------------|
| M1 | Welcome screen | Mode toggle (audio/video), access code input, feature list, staggered animations |
| M2 | StatusBadge | Animated dot + voice ring showing idle/connecting/listening/speaking/searching/processing |
| M3 | Timer chips | Countdown display with warning pulse (<=10s), expire animation, auto-remove |
| M4 | Preference chips | Subtle chips below header showing saved preferences |
| M5 | Audio visualizer | 5 frequency bars driven by AnalyserNode (speaking) or mic RMS (listening) |
| M6 | Error/reconnect banners | In-document-flow banners for mic/camera/WS errors and reconnection status |
| M7 | Error boundary | Catches React crashes, shows reload button |
| M8 | Wake Lock | Keeps screen on during cooking session, auto-re-acquires after system release |
| M9 | Camera flip | Front/rear toggle with reentry guard |
| M10 | Haptic vibration | Timer warning zone (<=10s) vibrates on mobile |
| M11 | `prefers-reduced-motion` support | Static bars, killed animations |
| M12 | Accessibility | aria-live regions, aria-labels, keyboard nav, focus rings, sr-only status text |
| M13 | Double-click guard | `isStartingRef` prevents two rapid Start clicks |
| M14 | `safeSend()` wrapper | Catches exceptions from sockets transitioning to CLOSING between readyState check and send |
| M15 | Browser feature detection gate | Checks AudioContext/AudioWorklet/getUserMedia — shows "use Chrome or Edge" if missing |
| M16 | Transient error auto-dismiss | Camera and WS errors auto-hide after 8s; mic errors are persistent (require user action) |
| M17 | Welcome code input UX | autoFocus, Enter key to start, maxLength=100, aria-invalid on error |
| M18 | Visualizer frequency binning | Groups FFT bins into 5 bars with center-weighted scaling (`[0.6, 0.8, 1.0, 0.8, 0.6]`), min height 0.08 |
| M19 | Canvas center-crop for camera | Crops video to 768x768 square from center (not letterbox) for any camera aspect ratio |
| M20 | Playback worklet diagnostics | Tracks queue high-water mark, cap hits, underrun count, consumed samples — reported every ~1s |

---

## N. INFRASTRUCTURE

| # | Thing | What it does |
|---|-------|-------------|
| N1 | Windows console encoding fix | `sys.stdout.reconfigure(encoding="utf-8")` to prevent emoji crashes |
| N2 | Dotenv load ordering | `load_dotenv()` MUST happen before ADK imports |
| N3 | Health endpoint | GET `/health` returns 200 |
| N4 | Module-level state (single-user) | `_active_timers`, `_event_queue`, `_last_search_request`, `_consecutive_errors` are process-wide singletons |
| N5 | Async task lifecycle management | All `create_task()` calls stored in sets, cancelled in `finally` block |
| N6 | Queue close on disconnect | `live_request_queue.close()` prevents zombie sessions |
| N7 | CORS origins configuration | Reads `CORS_ORIGINS` env var (comma-separated), falls back to localhost defaults |
| N8 | Valid ID regex validation | WebSocket path params validated against `^[a-zA-Z0-9_-]+$` — prevents log injection and ID spoofing |
| N9 | Vite proxy config | Dev server proxies `/ws` and `/api` to localhost:8080 — backend must be running first |
| N10 | Start scripts | `start.bat` and `start-frontend.bat` for Windows — launches both servers in separate terminals |
| N11 | CSS safe-area-inset padding | Applied to body, session header/footer for notched mobile devices |
| N12 | Welcome paper texture overlay | SVG-based Perlin noise texture (feTurbulence), opacity 0.03 — subtle organic feel |

---

## TOTAL COUNT

| Category | Count |
|----------|-------|
| A. Tools | 7 |
| B. Gemini Bug Workarounds | 12 |
| C. Audio Processing | 14 |
| D. Barge-in System | 4 |
| E. Session Lifecycle | 10 |
| F. Custom Event System | 7 |
| G. Timer System | 15 |
| H. Preference System | 6 |
| I. ADK Configuration | 15 |
| J. Prompt Engineering | 14 |
| K. Logging & Observability | 17 |
| L. Rate Limiting & Validation | 7 |
| M. UI Features | 20 |
| N. Infrastructure | 12 |
| **TOTAL** | **160** |

---

## WHAT'S ACTUALLY VANILLA ADK

For reference, the parts that ARE standard ADK usage (not custom):
- `Agent` class with `model`, `instruction`, `tools`
- `Runner` with `run_async`
- `LiveRequestQueue` for BIDI streaming input
- ADK event iteration in downstream loop
- `tool_context.state` for state management
- `SessionService` / `MemoryService` interfaces
- `Blob` for audio/image input
