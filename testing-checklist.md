# Testing Checklist — Audio Only

Check each box when it passes. Write notes if something fails.
Share the log file from `backend/logs/` after testing.

**Start:** Run backend, open frontend in Chrome, select "Audio Only", code `cookwithmia26`, click Start.

---

## 1. Connection + Greeting
- [x] Backend starts without errors
- [x] App loads, welcome screen shows "Audio Only" selected
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

## 10. Google Search
- [ ] Say: "What temperature should I cook chicken to?" → Mia says filler ("let me check on that" or similar), button shows "Searching...", then gives answer (165°F/74°C)
- [x] Say: "How do I dice an onion?" → Mia answers directly, no search indicator
- [x] Search result spoken ONCE, not repeated
- [ ] If search fails → Mia still responds with a fallback, not silence

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
