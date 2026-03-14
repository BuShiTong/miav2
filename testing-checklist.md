# Testing Checklist

Check each box when it passes. Write notes if something fails.
Share the log file from `backend/logs/` after testing.

**Start:** Run backend, open frontend in Chrome, enter code `cookwithmia26`, click Start (starts audio-only, camera can be toggled on mid-session).

---

## 1. Connection + Greeting
- [x] Backend starts without errors
- [x] App loads, welcome screen shows (no mode selector)
- [x] Enter code, click Start → connection sound plays, button shows "Listening..."
- [x] Mia greets you within 2-3 seconds ("Hey! What are we cooking?" or similar)
- [ ] Enter wrong code → error shown, can retry with correct code

## 2. Basic Conversation
- [x] Say: "I'm making spaghetti bolognese tonight" → Mia responds about pasta/bolognese
- [ ] Mia keeps responses short (5-35 words, not lectures)
- [ ] 3-4 exchanges back and forth → Mia remembers earlier context

## 3. Preferences
- [x] Say: "I'm allergic to nuts" → silent save, one confirmation, chip appears
- [x] Say: "I'm vegetarian" → same: silent, one response, chip appears
- [ ] Say: "I'm cooking for 4 people" → same behavior
- [ ] Say: "I'm a beginner cook" → same behavior
- [ ] No double-talk: Mia speaks ONCE per preference (no "let me save that" before confirming)

## 4. Timers — Set
- [x] Say: "Set a 2-minute timer for pasta" → Mia confirms once, timer appears counting down
- [x] Say: "Set a 30-second timer for garlic" → second timer appears, both count independently
- [ ] No double-talk: Mia speaks ONCE per timer set

## 5. Timers — Pause & Resume
- [x] Say: "Pause the pasta timer" → countdown stops, Mia confirms
- [x] Wait 10 seconds → timer still shows same time (not ticking while paused)
- [x] Say: "Resume the pasta timer" → countdown resumes, Mia confirms
- [x] Say: "Pause the pasta timer" when already paused → Mia says "already paused"
- [x] Say: "Resume the pasta timer" when already running → Mia says "already running"

## 6. Timers — Adjust
- [x] Say: "Add 1 minute to the pasta timer" → timer increases by 60s, Mia confirms
- [x] Say: "Take 30 seconds off the pasta timer" → timer decreases, Mia confirms

## 7. Timers — Cancel
- [x] Say: "Cancel the garlic timer" → timer disappears, Mia confirms
- [x] Say: "Cancel the chicken timer" (doesn't exist) → Mia says not found, no crash

## 8. Timers — Expiry
- [x] Let timer reach zero → 3 beeps, phone vibrates, Mia announces it's done
- [x] Timer auto-removes from screen after ~10 seconds
- [x] Say: "Pause the pasta timer" after it expired → Mia says not found, no crash
- [ ] Say: "Set a timer" (no label) → Mia asks what it's for (label required)

## 9. Timers — Label Lookup
- [ ] Two timers running (pasta + rice). Say: "Pause the rice timer" → correct one pauses
- [ ] Say: "Add 2 minutes to the pasta timer" → only pasta changes, rice unaffected

## 10. Google Search (Native — transparent, no "Searching..." indicator)
- [ ] Say: "What temperature should I cook chicken to?" → Mia gives answer with specific number (165°F/74°C). No search_web tool call in logs — search is built-in.
- [ ] Say: "How do I dice an onion?" → Mia answers directly
- [ ] Search result spoken ONCE, not repeated
- [ ] If search fails (e.g. no internet) → Mia still responds from memory, not silence

## 11. Multiple Tools at Once
- [ ] Say: "I'm allergic to shellfish and set a 30-second timer for rice" → chip appears AND ONE timer starts (not two), Mia responds ONCE about both
- [ ] Say: "I'm vegan and cooking for 2" → both saved, Mia confirms both in one response
- [ ] No separate responses — exactly ONE reply covering everything

## 12. Barge-In
- [ ] While Mia is talking, say: "Wait, actually—" → Mia stops immediately, no overlap
- [ ] After interrupting, ask something new → Mia responds to new question normally
- [ ] While Mia is talking, clap/tap counter → Mia keeps talking (noise doesn't interrupt)
- [ ] While Mia is talking, say clearly: "Hold on a second" → Mia stops

## 13. Tool Call Validation
- [ ] Say: "I'd like to make pasta" (no preference mentioned) → Mia does NOT save any preference. Check log for "VALIDATION REJECTED"
- [ ] Say: "Tell me about chicken" without asking for a timer → Mia does NOT set/pause/resume any timer
- [ ] Say: "I'm allergic to nuts" → preference saved. Check log for "VALIDATION PASSED"
- [ ] Check log: tool calls show VALIDATION PASSED or VALIDATION REJECTED with reason

## 14. Affective Dialog (Vertex Feature)
- [ ] Say enthusiastically: "Oh my god, this smells AMAZING!" → does Mia sound upbeat?
- [ ] Say frustrated: "Ugh, I think I burned it" → does Mia sound empathetic?
- [ ] Note: subtle. Mark what you notice, even if "no difference"

## 15. Session Stability
- [ ] 2+ minute conversation with tools → no crashes, no silence gaps
- [ ] 5+ minute conversation → audio quality stays consistent
- [ ] Rapid fire: "I'm gluten free. Set a 1-minute timer for test. What temp for salmon?" → all three work

## 16. Stop & Restart
- [ ] Click Stop → welcome screen reappears, timers gone, no leftover audio
- [ ] Click Start again → fresh session, Mia greets, previous conversation gone
- [ ] Click Stop then immediately Start → new session starts cleanly

## 17. Screen & Wake Lock
- [ ] During session, leave idle 30s → screen stays on
- [ ] After Stop → screen allowed to dim normally

## 18. Tab Switching
- [ ] Switch to another tab, wait 5s, switch back → audio resumes, no crash

## 19. Reconnection
- [ ] If "Reconnecting..." appears → does it auto-reconnect within seconds?
- [ ] After reconnect → can you keep talking?
- [ ] Note: hard to force. Just note if it happens naturally.

## 20. Voice Quality
- [ ] Mia's voice is clear — no static, echo, or distortion
- [ ] Natural speaking pace — not too fast, not too slow
- [ ] Words not cut off mid-sentence (unless you interrupt)
- [ ] Check log: "User:" lines match what you actually said

## 21. Goodbye
- [ ] Say: "Thanks, we're done!" → Mia says warm goodbye

## 22. Log Verification
Open latest file in `backend/logs/`:
- [ ] "User:" and "Mia:" lines match the conversation
- [ ] "Tool call received:" for each tool used
- [ ] "VALIDATION PASSED" or "VALIDATION REJECTED" for each tool call
- [ ] "Tool result:" with success and timing for passed calls
- [ ] Tool responses sent in batches (e.g. "Tool responses sent (2)")
- [ ] No ERROR lines or stack traces

## 23. Preference Safety Embedding (NEW)
Tests that allergies survive long conversations and can't be "forgotten."
- [ ] Say: "I'm allergic to nuts" → chip appears, check log for "Preference context injected"
- [ ] Continue talking for 2+ minutes about other topics
- [ ] Say: "What can I add to this salad?" → Mia should NOT suggest nuts/peanuts
- [ ] Check log: `[User preferences — allergies: nuts. Always respect these.]` appears after the tool call

## 24. Preference Negation + Merge (NEW)
- [ ] Say: "I'm allergic to nuts" → chip shows "nuts"
- [ ] Say: "I'm also allergic to shellfish" → chip updates to "nuts, shellfish" (merged, not replaced)
- [ ] Say: "Actually, I have no allergies" → chip disappears entirely
- [ ] Check log: "Preference cleared: allergies" appears
- [ ] Say: "I'm vegetarian" → chip appears
- [ ] Say: "Actually clear my dietary preference" → chip disappears

## 25. Timer Validation Limits (NEW)
- [ ] Say: "Set a timer for 10 hours" → Mia should refuse (max 8 hours)
- [ ] Set 5 timers, then ask for a 6th → Mia says max timers reached
- [ ] Check log: no timer labels contain special characters (sanitized)

## 26. Duration Formatting (NEW)
- [ ] Say: "Set a 5 minute timer for pasta" → check log: tool result includes `duration_display: "5 minutes"`
- [ ] Say: "Set a 90 second timer for eggs" → check log: `duration_display: "1 minute 30 seconds"`
- [ ] Mia should say the time naturally (not "300 seconds")

## 27. Camera Vision (via mid-session toggle)
Tap camera toggle button during an active session.
- [ ] Enable camera, show a cutting board or pan → Mia acknowledges what she sees
- [ ] Show something cooking on a stove → Mia comments on cooking progress
- [ ] (If possible) show something smoking → does Mia warn about safety?
- [ ] Don't show anything interesting → Mia stays quiet (doesn't narrate everything)

## 28. Camera Toggle (NEW)
- [ ] Welcome screen has NO mode selector (audio/video choice removed)
- [ ] Session starts audio-only by default
- [ ] Tap camera toggle mid-session → camera turns on, loading state shown briefly, then feed appears
- [ ] Camera uses front-facing by default
- [ ] Tap camera toggle again → camera turns off, returns to audio visualizer
- [ ] Rapid double-tap on camera toggle → no crash, single state change
- [ ] Deny camera permission when prompted → graceful error, session continues audio-only
- [ ] Toggle camera off and on during active reconnection → no crash or stuck state
- [ ] Haptic feedback fires on each camera toggle tap

## 29. Session Layout (NEW)
- [ ] Timers appear at top of session view (above camera/visualizer)
- [ ] Preference chips appear at bottom of session view
- [ ] Timers and prefs are visibly larger than before
- [ ] Camera feed is nearly full-screen with floating chips overlaid
- [ ] Border glow changes based on audio state (speaking vs listening)
- [ ] Preference chips auto-fade after appearing
- [ ] Switching between camera and visualizer uses crossfade transition

## 30. Error Messages (was #28)
- [ ] Stop the backend, try to connect → error message is playful (not generic)
- [ ] Disconnect Wi-Fi, try to connect → different playful error
- [ ] Note the exact messages — are they fun and clear about what's wrong?

## 31. Context Window Compression
- [ ] Start audio-only session, talk for 5+ min → no crashes, session remains stable
- [ ] Start camera session, keep camera on 5+ min → no crashes (previously would overflow)
- [ ] Check log: "compression=trigger@100k/target@80k" appears on session start

## 32. Session Resumption
- [ ] Start a session, talk for a minute, then wait ~10 min for GoAway
- [ ] Check log: "GoAway received" and "Session resumption handle captured" appear
- [ ] After reconnect: ask Mia about something from the earlier conversation → she remembers
- [ ] Check log: "resuming=True" on the reconnected session, "Resumed session — skipping greeting"
- [ ] Fresh start (click Stop then Start): Mia greets normally (not resuming)

## 33. System Instruction Updates
- [ ] Set a preference ("I'm allergic to nuts"), then wait 5 min
- [ ] Check log: "System instruction update: User preferences: allergies: nuts" appears
- [ ] Set a timer, wait 5 min → log shows timer state in system instruction update
- [ ] After long session (10+ min): ask about allergies → Mia still knows (system instruction survived compression)

## 34. Preference Persistence Across Crashes
Tests that allergies survive Gemini connection resets.
- [ ] Say "I'm allergic to nuts" → chip appears, check log for "Preference context injected"
- [ ] Wait for GoAway/reconnect (or stop backend briefly to force reconnect)
- [ ] After reconnect → check log: "Restored N preferences" with allergy data
- [ ] Preference chips should reappear on frontend after reconnect
- [ ] Next periodic system instruction update (5 min) should include restored allergies
- [ ] Click Stop → Start new session → preferences should be gone
- [ ] Check log: "Clean disconnect — cleared saved state" on Stop
- [ ] Fresh start: no "Restored preferences" log line

## 35. WebSocket Send Timeout
Tests that dead client connections are cleaned up instead of hanging.
- [ ] Normal session works identically — no timeout warnings in log during healthy conversation
- [ ] Kill browser tab mid-conversation (Task Manager or close tab) → check backend log: "WebSocket send timed out" appears within 5 seconds
- [ ] After timeout: backend session ends cleanly (no hanging processes)
- [ ] Rapid audio playback (continuous Mia speaking) → no timeout warnings (healthy sends complete well under 5s)

## 36. Health Endpoint
- [ ] `curl http://localhost:8000/health` → returns `{"status":"ok"}` with HTTP 200
- [ ] Health endpoint works even when no WebSocket sessions are active
- [ ] No log entries created by health check hits

## 37. WebSocket ID Validation
- [ ] Normal session connects fine (frontend-generated IDs pass validation)
- [ ] Check backend log: no "Rejected WebSocket" warnings during normal use
- [ ] (Advanced) Connect with malicious user_id containing `../` or newlines → connection closed with 1008
- [ ] (Advanced) Connect with 200-character ID → connection closed with 1008

## 38. Pre-Deployment Cleanup
- [ ] Remove `[DEBUG] Google Search grounding detection` block from `main.py` (search for `[SEARCH]`)

---

## Scorecard

| # | Section | Pass | Fail | Notes |
|---|---------|------|------|-------|
| 1 | Connection + Greeting | | | |
| 2 | Basic Conversation | | | |
| 3 | Preferences | | | |
| 4 | Timers — Set | | | |
| 5 | Timers — Pause & Resume | | | |
| 6 | Timers — Adjust | | | |
| 7 | Timers — Cancel | | | |
| 8 | Timers — Expiry | | | |
| 9 | Timers — Label Lookup | | | |
| 10 | Google Search | | | |
| 11 | Multiple Tools | | | |
| 12 | Barge-In | | | |
| 13 | Tool Call Validation | | | |
| 14 | Affective Dialog | | | |
| 15 | Session Stability | | | |
| 16 | Stop & Restart | | | |
| 17 | Wake Lock | | | |
| 18 | Tab Switching | | | |
| 19 | Reconnection | | | |
| 20 | Voice Quality | | | |
| 21 | Goodbye | | | |
| 22 | Log Verification | | | |
| 23 | Preference Safety Embedding | | | |
| 24 | Preference Negation + Merge | | | |
| 25 | Timer Validation Limits | | | |
| 26 | Duration Formatting | | | |
| 27 | Camera Vision | | | |
| 28 | Camera Toggle | | | |
| 29 | Session Layout | | | |
| 30 | Error Messages | | | |
| 31 | Context Window Compression | | | |
| 32 | Session Resumption | | | |
| 33 | System Instruction Updates | | | |
| 34 | Preference Persistence Across Crashes | | | |
| 35 | WebSocket Send Timeout | | | |
| 36 | Health Endpoint | | | |
| 37 | WebSocket ID Validation | | | |
| 38 | Pre-Deployment Cleanup | | | |
