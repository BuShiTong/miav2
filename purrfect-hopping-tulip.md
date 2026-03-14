# Every Custom Mechanism in Mia — What It Does, Why It Exists, and Whether You Need It

This is a reference document, not an implementation plan. It covers every workaround, tweak, and custom mechanism built on top of the vanilla Gemini SDK.

---

## 1. TOOL CALL VALIDATION (backend/tools.py)

**What it does:** Before executing a tool call from the AI, the system checks the user's actual spoken words (transcription) to see if they match what the tool is trying to do.

**Example:** If the AI tries to set an allergy to "gluten" but the user never said "gluten", the call gets rejected. The AI receives `{"status": "skipped"}` instead of executing it.

**When it triggers:** Every time the AI calls `update_user_preference` or `manage_timer`. Search is always allowed.

**Why it exists:** The AI sometimes hallucinates — it invents preferences the user never mentioned, or pauses/resumes timers on its own without being asked. System prompt instructions telling it "don't do that" only work ~33% of the time.

**Tradeoffs:**
- **Good:** Prevents wrong allergies being saved, prevents phantom timer actions
- **Bad:** If the transcription is delayed or missing, the system "fails open" (allows the call anyway) — so it's not a perfect safety net
- **Bad:** If the user uses unusual words the keyword list doesn't include, a valid request might get rejected (but this seems rare based on testing)

**If you remove it:** The AI will occasionally save wrong preferences or mess with timers without being asked. How often depends on the model version.

---

## 2. TOOL CALL BUFFERING — 300ms DELAY (backend/main.py)

**What it does:** When the AI makes a tool call, the system waits 300ms before executing it. During that window, it collects any additional tool calls that arrive (the AI sometimes fires multiple calls in rapid succession).

**When it triggers:** Every tool call gets buffered.

**Why it exists:** Two reasons:
1. The transcription of what the user said arrives ~3ms after the tool call. Buffering ensures the transcription is available for validation (see #1 above).
2. When the user says something like "I'm allergic to nuts AND set a 10-minute timer", the AI might fire two separate tool calls. Buffering lets them be processed together.

**Tradeoffs:**
- **Good:** Enables validation to work, reduces duplicate tool calls
- **Bad:** Adds 300ms latency to every tool action (barely noticeable in practice)

**If you remove it:** Validation (#1) would often fail because transcription hasn't arrived yet. You'd also get more duplicate tool calls.

---

## 3. BARGE-IN DETECTION (frontend/useAudioCapture.ts)

**What it does:** Detects when the user starts talking while the AI is still speaking, so the AI can be interrupted.

**How it works:** Measures the loudness (RMS) of the microphone input. Maintains a running average of background noise (the "echo baseline"). If the mic picks up sound that's 3x louder than the baseline AND above an absolute minimum threshold (0.015), it counts as speech.

**When it triggers:** Only while the AI is actively playing audio (within a 500ms window of the last audio chunk).

**Why it exists:** Without this, the user would have to wait for the AI to finish talking before they could say anything. In a cooking scenario, you need to be able to interrupt ("wait, I don't have that ingredient!").

**Key detail — echo cancellation is OFF:** The browser's built-in echo cancellation is deliberately disabled. This sounds backwards, but Chrome's echo cancellation crushes the microphone signal so aggressively that speech detection becomes nearly impossible. With it off, the system uses its own adaptive threshold instead.

**Tradeoffs:**
- **Good:** Natural conversation flow, user can interrupt anytime
- **Bad:** With echo cancellation off, loudspeaker users might get false triggers (headphones recommended)
- **Bad:** The threshold values (3x multiplier, 0.015 minimum) are tuned by trial and error — different environments might need different values

**If you remove it:** Users can't interrupt the AI. They'd have to wait for it to finish every response.

---

## 4. BARGE-IN AUDIO FLUSH (frontend/useAudioPlayback.ts)

**What it does:** When barge-in is detected, instantly mutes the speaker and clears all queued audio. When the AI's new response starts, it unmutes.

**When it triggers:** Whenever barge-in detection (#3) fires, or when the backend sends an `interrupted` signal.

**Why it exists:** If you just stop sending new audio but don't clear the queue, the user would hear the rest of the old response before the new one starts. The flush makes the cutoff feel instant.

**Implementation detail:** Uses immediate gain muting (gain = 0) plus worklet queue clearing. No setTimeout — this avoids race conditions where old audio leaks through.

**Tradeoffs:**
- **Good:** Clean, instant interruption with no audio artifacts
- **Bad:** None significant — this is straightforward audio engineering

**If you remove it:** Interrupting the AI would feel sluggish. Old audio would keep playing for a moment before the new response starts.

---

## 5. SYSTEM PROMPT TOOL BEHAVIOR RULES (backend/main.py)

**What it does:** The system prompt tells the AI how to behave around tool calls — specifically, "Only use tools when user explicitly asks."

**History:** This went through many iterations (see decisions.md #32). Started with 7 detailed rules about when to speak, when to stay silent, and how to handle tool results. None of them were reliably followed. Eventually simplified to one line.

**When it triggers:** Every conversation — it's baked into the system prompt.

**Why it exists:** The Vertex AI model tends to narrate what it's about to do ("Let me set that timer for you...") and then repeat itself after the tool completes ("I've set a 10-minute timer for you!"). The prompt tries to prevent this.

**Tradeoffs:**
- **Good:** Reduces narration and repetition by ~33%
- **Bad:** The AI ignores these instructions ~67% of the time — it's a suggestion, not a guarantee
- **Bad:** Overly restrictive rules can make the AI sound robotic or unnatural

**If you remove it:** More narration before tool calls, more repetition after. The validation layer (#1) still prevents wrong actions, but the user experience gets chattier.

---

## 6. TIMER DEDUPLICATION — 10-SECOND WINDOW (backend/tools.py)

**What it does:** If the AI tries to set a timer with the same label as one that was set less than 10 seconds ago, it returns "already set" instead of creating a duplicate.

**When it triggers:** Only on `manage_timer` with action "set".

**Why it exists:** The AI sometimes fires the same tool call twice in quick succession (a known Gemini behavior). Without dedup, you'd get two identical timers.

**Tradeoffs:**
- **Good:** Prevents confusing duplicate timers
- **Bad:** If a user genuinely wants two timers with the same name within 10 seconds, they can't (very unlikely scenario)

**If you remove it:** Occasional duplicate timers when the AI double-fires.

---

## 7. SPEECH DETECTION SENSITIVITY — SET TO LOW (backend/main.py)

**What it does:** The Gemini API has built-in voice activity detection (VAD) that decides when the user starts/stops speaking. Setting both start and end sensitivity to LOW makes it less trigger-happy.

**When it triggers:** Always active during a session.

**Why it exists:** In a kitchen environment, there's background noise (pots, running water, etc.). High sensitivity would cause the AI to think the user is speaking when they're not, leading to interruptions and confused responses.

**Tradeoffs:**
- **Good:** Fewer false triggers from kitchen noise
- **Bad:** The user might need to speak slightly louder or more clearly for the AI to pick up
- **Bad:** Slightly longer pause needed between sentences before the AI considers the user "done speaking"

**If you remove it:** More false triggers in noisy environments, but possibly more responsive in quiet ones.

---

## 8. IMAGE FRAME RATE LIMITING — 1 PER SECOND (backend/main.py)

**What it does:** When the camera is on, the backend only forwards one image per second to the AI, even if more arrive.

**When it triggers:** Every camera frame goes through this gate.

**Why it exists:** Sending too many frames overwhelms the AI model and uses up context window. One per second is enough to see what's on the cutting board.

**Tradeoffs:**
- **Good:** Keeps costs down, prevents model overload
- **Bad:** Fast-moving actions (like quickly flipping something) might be missed

**If you remove it:** Higher costs, potentially slower responses as the model processes more images.

---

## 9. PRE-WARM GREETING (backend/main.py)

**What it does:** When a session starts, the backend sends a fake "user message" that says `[Session started]`. This makes the AI speak first.

**When it triggers:** Once at session start.

**Why it exists:** Without it, the AI would wait silently for the user to speak first. The greeting makes the experience feel welcoming — like walking into a kitchen where your friend says "Hey! What are we making today?"

**Tradeoffs:**
- **Good:** Natural, friendly start to every session
- **Bad:** None significant — it's a common pattern

**If you remove it:** Awkward silence at the start. User would need to speak first.

---

## 10. AFFECTIVE DIALOG (backend/main.py)

**What it does:** `enable_affective_dialog=True` tells the Vertex AI model to react to the user's tone of voice — if they sound frustrated, the AI adjusts its tone to be more empathetic; if excited, the AI matches the energy.

**When it triggers:** Always active (Vertex AI only feature).

**Why it exists:** Makes the interaction feel more human and responsive.

**Tradeoffs:**
- **Good:** More natural, emotionally aware responses
- **Bad:** Subtle — hard to verify it's actually working
- **Bad:** Might get rejected by the API in the future (known risk per CLAUDE.md)

**If you remove it:** The AI still works fine, just less emotionally responsive. Conversations feel slightly more "flat."

---

## 11. CONTROL TOKEN STRIPPING (frontend/useWebSocket.ts)

**What it does:** The AI's transcribed text sometimes contains tokens like `<ctrl23>` or `<ctrl100>`. These are internal control markers from the native audio model. The frontend strips them out before displaying or logging.

**When it triggers:** Every output transcription message.

**Why it exists:** Without stripping, logs and any displayed text would contain gibberish control codes.

**Tradeoffs:**
- **Good:** Clean transcription text
- **Bad:** None

**If you remove it:** Ugly control tokens in your logs and any text display.

---

## 12. AUTO-RECONNECT WITH EXPONENTIAL BACKOFF (frontend/useWebSocket.ts)

**What it does:** If the connection to Gemini drops (which happens — sessions have time limits, network blips occur), the frontend automatically tries to reconnect up to 5 times. Each retry waits longer: ~1.5s, ~3s, ~6s, ~12s, ~24s. A random ±20% "jitter" prevents all clients from reconnecting at the same instant.

**When it triggers:** When the backend sends a `gemini_disconnected` message.

**Why it exists:** Gemini Live sessions can drop unexpectedly. Without auto-reconnect, the user would need to manually stop and restart.

**Tradeoffs:**
- **Good:** Seamless recovery from connection drops
- **Bad:** During reconnection (a few seconds), the user can't interact

**If you remove it:** Any connection drop = session over. User must manually restart.

---

## 13. WAKE LOCK (frontend/useWakeLock.ts)

**What it does:** Keeps the phone/tablet screen from turning off during a cooking session. Also re-acquires the lock if the user switches tabs and comes back.

**When it triggers:** Acquired when session starts, released when session stops.

**Why it exists:** Your hands are covered in flour — you can't tap the screen to keep it awake.

**Tradeoffs:**
- **Good:** Screen stays on while cooking
- **Bad:** Uses more battery

**If you remove it:** Screen turns off after the device's normal timeout. Annoying during cooking.

---

## 14. TIMER SYSTEM — DRIFT-RESISTANT COUNTDOWN (frontend/useTimers.ts)

**What it does:** Instead of counting down by subtracting 1 each second (which drifts), timers store an absolute "target time" (e.g., "expire at 3:45:00 PM"). Every tick recalculates remaining = target minus now.

**When it triggers:** Every second for all active timers.

**Why it exists:** Simple "subtract 1 each second" timers drift because JavaScript's `setInterval` isn't perfectly accurate. Over a 30-minute timer, you could be off by several seconds. Absolute timestamps don't drift.

**Also:** Timers survive page reloads via localStorage. On reload, the system recalculates remaining time from the stored target.

**Tradeoffs:**
- **Good:** Accurate timers, survive page reloads
- **Bad:** Slightly more complex code

**If you remove it:** Timers would gradually become inaccurate, especially long ones. Page reload = lost timers.

---

## 15. PREFERENCE NEGATION HANDLING (frontend/usePreferences.ts)

**What it does:** When the user says "no allergies" or "none" or "clear", the system removes that preference chip instead of saving "none" as a value.

**When it triggers:** When a preference update event arrives with a negation word.

**Why it exists:** Without it, you'd see a chip saying "Allergies: none" which is confusing and takes up space.

**Tradeoffs:**
- **Good:** Clean UI
- **Bad:** If someone's allergy is literally called something in the negation list (very unlikely), it would be removed

**If you remove it:** "Allergies: none" chip stays visible. Minor UI annoyance.

---

## 16. SEARCH USING A SEPARATE CHEAP MODEL (backend/tools.py)

**What it does:** Web searches use `gemini-2.5-flash-lite` (a cheap, fast model) instead of the main native audio model.

**When it triggers:** Every `search_web` tool call.

**Why it exists:** Two reasons:
1. The native audio model only works through the Live API — it can't do regular text generation with Google Search grounding
2. Flash-lite is much cheaper and faster for simple search queries

**Additional detail:** Thinking is disabled (`thinking_budget=0`) to keep it fast.

**Tradeoffs:**
- **Good:** Fast, cheap searches that actually work
- **Bad:** Search quality is limited by the lite model's capabilities

**If you remove it:** No web search capability at all (the native audio model can't do it).

---

## 17. SEARCH SAFETY TIMEOUT — 15 SECONDS (frontend/useSearch.ts)

**What it does:** If a search starts but the "search complete" event never arrives within 15 seconds, the UI automatically clears the "Searching..." state.

**When it triggers:** 15 seconds after search starts with no completion event.

**Why it exists:** If the backend crashes or the event gets lost, the UI would be stuck showing "Searching..." forever.

**Tradeoffs:**
- **Good:** Prevents stuck UI state
- **Bad:** None

**If you remove it:** Risk of permanently stuck "Searching..." indicator if something goes wrong.

---

## 18. PLAYBACK AUDIO WORKLET WITH QUEUE CAP (frontend/playback-processor.js)

**What it does:** Stores incoming audio chunks in a queue (max 1000 chunks ≈ 40 seconds). If the queue gets full, it drops the oldest chunk. Sends a "heartbeat" every ~250ms to signal it's still playing.

**When it triggers:** Continuously during audio playback.

**Why it exists:** Gemini sends audio in bursts — sometimes many chunks arrive at once. The queue smooths this out into continuous playback. The cap prevents memory from growing forever if something goes wrong.

**The heartbeat** is used by barge-in detection (#3) to know whether the AI is currently playing audio.

**Tradeoffs:**
- **Good:** Smooth playback despite bursty delivery, memory-safe
- **Bad:** 1000-chunk cap means if somehow 40+ seconds of audio queues up, old audio gets dropped (hasn't happened in practice)

**If you remove it:** Audio playback would be choppy or break entirely.

---

## 19. CAPTURE AUDIO WORKLET — 100ms CHUNKS (frontend/capture-processor.js)

**What it does:** Buffers microphone input into 100ms chunks (1600 samples at 16kHz) before sending to the backend.

**When it triggers:** Continuously while microphone is active.

**Why it exists:** Without buffering, the browser sends tiny chunks (~128 samples) which means ~125 WebSocket messages per second. Buffering reduces this to ~10 messages per second, which is much more efficient.

**Tradeoffs:**
- **Good:** 12x fewer WebSocket messages, recommended by Google's documentation
- **Bad:** Adds up to 100ms of latency to speech detection (minor in practice)

**If you remove it:** Massive increase in WebSocket traffic. Might cause performance issues.

---

## 20. REMOTE LOG SHIPPING (frontend/logger.ts)

**What it does:** Collects all frontend logs in a buffer and sends them to the backend every 3 seconds. On page close, uses `sendBeacon` to guarantee the last batch gets sent. On errors, flushes immediately.

**When it triggers:** Continuously during a session.

**Why it exists:** When users report bugs, you need frontend logs to diagnose the issue. Without shipping, those logs are lost when the page closes.

**Tradeoffs:**
- **Good:** Complete debugging trail for every session
- **Bad:** Small amount of network traffic every 3 seconds

**If you remove it:** No frontend logs for debugging. You'd only have backend logs, which miss client-side issues entirely.

---

## 21. PER-SESSION LOG FILES (backend/main.py)

**What it does:** Each session gets its own log file named with timestamp and session ID, stored in `backend/logs/`.

**When it triggers:** One file created per WebSocket connection.

**Why it exists:** Makes it easy to find logs for a specific session when debugging.

**Tradeoffs:**
- **Good:** Organized debugging
- **Bad:** Disk usage (many sessions = many files, though each is small)

**If you remove it:** All sessions log to one file, making it harder to isolate issues.

---

## 22. WINDOWS UNICODE FIX (backend/main.py)

**What it does:** Forces Python's stdout/stderr to use UTF-8 encoding with error replacement on Windows.

**When it triggers:** At import time, before anything else runs.

**Why it exists:** The AI sometimes outputs emoji or special characters. Windows console defaults to a narrow encoding that crashes when it encounters these.

**Tradeoffs:**
- **Good:** No crashes from emoji in logs
- **Bad:** None

**If you remove it:** Occasional crashes on Windows when the AI uses emoji.

---

## 23. ANTI-CLICK AUDIO RAMP (frontend/useAudioPlayback.ts)

**What it does:** When stopping playback, ramps the volume to zero over 20ms instead of cutting instantly.

**When it triggers:** When the user hits Stop.

**Why it exists:** Cutting audio instantly creates an audible "pop" or "click" sound. The ramp makes it smooth.

**Tradeoffs:**
- **Good:** Clean audio stop
- **Bad:** None

**If you remove it:** Audible click/pop when stopping a session.

---

## 24. DOUBLE-CLICK GUARD (frontend/App.tsx)

**What it does:** Uses a synchronous ref (`isStartingRef`) to prevent the Start button from being clicked twice before React re-renders.

**When it triggers:** Every Start button click.

**Why it exists:** React batches state updates, so `isStarting` state might not be `true` yet when a fast second click arrives. The ref updates immediately (synchronous), blocking the second click.

**Tradeoffs:**
- **Good:** Prevents duplicate sessions
- **Bad:** None

**If you remove it:** Fast double-clicks could start two sessions simultaneously, causing audio chaos.

---

## 25. CONNECTION TIMEOUT — 10 SECONDS (frontend/useWebSocket.ts)

**What it does:** If the WebSocket hasn't connected within 10 seconds, it gives up and shows an error.

**When it triggers:** Every connection attempt.

**Why it exists:** Without it, users could stare at "Connecting..." indefinitely if the backend is down.

**Tradeoffs:**
- **Good:** Clear feedback when things are broken
- **Bad:** 10 seconds might feel long (but shorter risks false timeouts on slow networks)

**If you remove it:** No timeout = potentially infinite "Connecting..." state.

---

## 26. TIMER EXPIRY BEEP + HAPTICS (frontend/useTimers.ts)

**What it does:** When a timer hits zero: plays a 3-beep sound pattern (880Hz, A5 note), vibrates the device in a pattern `[100, 50, 100, 50, 100]`, and sends a message to the AI so it can announce it.

**Also:** A warning haptic fires once when a timer enters the "10 seconds remaining" zone.

**Beep suppression:** Beeps are suppressed until the first timer is set in the current session. This prevents old timers loaded from localStorage from beeping on page load.

**When it triggers:** Timer reaching zero, timer entering ≤10s zone.

**Why it exists:** Hands-covered-in-food user needs an unmissable alert. Sound alone might not be enough if there's kitchen noise.

**Tradeoffs:**
- **Good:** Multi-sensory timer alerts
- **Bad:** Could be annoying in quiet environments (but that's kind of the point of a timer)

**If you remove it:** Silent timer expiry. User might miss it.

---

## 27. URL-SAFE BASE64 CONVERSION (frontend/useAudioPlayback.ts)

**What it does:** Converts Gemini's URL-safe base64 audio (using `-` and `_`) to standard base64 (using `+` and `/`) before decoding.

**When it triggers:** Every audio chunk received.

**Why it exists:** Gemini sends audio encoded in URL-safe base64, but the browser's `atob()` function expects standard base64. Without conversion, decoding fails.

**Tradeoffs:**
- **Good:** Audio works
- **Bad:** None

**If you remove it:** All audio playback breaks.

---

## 28. TAB VISIBILITY HANDLING (frontend/useAudioCapture.ts, useWakeLock.ts)

**What it does:** When the user switches away from the tab and comes back, the system resumes the AudioContext (browsers suspend it on tab switch) and re-acquires the wake lock.

**When it triggers:** Every time the tab becomes visible again.

**Why it exists:** Browsers aggressively suspend background tabs to save resources. Without this, coming back to the tab would mean broken audio and a dark screen.

**Tradeoffs:**
- **Good:** Seamless tab switching
- **Bad:** None

**If you remove it:** Audio stops working after switching tabs. Screen might turn off.

---

## Summary Table

| # | Mechanism | Needed? | What breaks without it |
|---|-----------|---------|----------------------|
| 1 | Tool call validation | Strongly recommended | AI saves wrong preferences, phantom timer actions |
| 2 | Tool call buffering | Needed if #1 exists | Validation can't work without transcription timing |
| 3 | Barge-in detection | Essential | Can't interrupt the AI |
| 4 | Barge-in audio flush | Essential | Old audio keeps playing after interruption |
| 5 | System prompt rules | Nice to have | More AI narration/repetition (~33% improvement) |
| 6 | Timer dedup | Nice to have | Occasional duplicate timers |
| 7 | Low VAD sensitivity | Recommended for kitchen | False triggers from kitchen noise |
| 8 | Image rate limiting | Essential if camera on | Model overload, high costs |
| 9 | Pre-warm greeting | Recommended | Awkward silence at start |
| 10 | Affective dialog | Optional | Slightly less natural tone |
| 11 | Control token stripping | Essential | Gibberish in logs/text |
| 12 | Auto-reconnect | Strongly recommended | Connection drop = restart manually |
| 13 | Wake lock | Recommended for mobile | Screen turns off while cooking |
| 14 | Drift-resistant timers | Essential for accuracy | Timers drift, don't survive reload |
| 15 | Preference negation | Nice to have | "Allergies: none" chip visible |
| 16 | Separate search model | Essential | No search capability |
| 17 | Search timeout | Safety net | UI can get stuck on "Searching..." |
| 18 | Playback worklet + queue | Essential | Audio breaks |
| 19 | Capture worklet chunking | Essential | 125 msgs/sec WebSocket flood |
| 20 | Remote log shipping | Needed for debugging | No frontend diagnostics |
| 21 | Per-session log files | Nice to have | Harder to find specific session logs |
| 22 | Windows unicode fix | Essential on Windows | Crashes from emoji |
| 23 | Anti-click audio ramp | Nice to have | Audible pop on stop |
| 24 | Double-click guard | Essential | Duplicate sessions |
| 25 | Connection timeout | Essential | Infinite "Connecting..." |
| 26 | Timer beep + haptics | Essential for UX | Silent timer expiry |
| 27 | URL-safe base64 | Essential | Audio completely broken |
| 28 | Tab visibility handling | Essential | Audio dies on tab switch |

---

**Notable thing NOT in the codebase:** The audio gate described in vertex-migration-plan.md (Task 4) and decisions.md (#19, #24, #26) was built, tested, and then **removed** (Decision #26). It caused garbled audio fragments. The current approach relies on system prompt + validation + barge-in only. The plan file still describes it as the recommended approach, but it was removed after real-world testing showed it caused more problems than it solved.
