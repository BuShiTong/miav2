# Testing Checklist

Test one item at a time. Check the box when done. Add notes after each item.
After each test session, share the session log file from `backend/logs/` for review.

---

## Core Features (Steps 1-4)

### Connection + Voice
- [ ] Backend starts without errors
- [ ] Click Start → Mia greets you
- [ ] Say anything back → Mia responds with audio
- [ ] While Mia is talking, interrupt her → she stops and listens
- [ ] Click Stop → Start → new session works cleanly

### ~~Step 1 — Affective Dialog + Proactive Audio~~ ROLLED BACK
> Both `enable_affective_dialog` and `proactivity` are rejected by the API for our model. Neither config flag works. Camera vision still works (Mia sees when asked). Proactive commenting may be possible via system prompt (Step 8).

### Google Search (Step 2)
- [ ] Ask "What temp should I cook chicken to?" — correct USDA answer (165F/74C)
- [ ] Amber search indicator appears while searching, disappears when done
- [ ] Search response comes back in under 2-3 seconds
- [ ] Ask something basic ("how do I dice an onion?") — she answers directly, no search
- [ ] If internet is slow/down — Mia still responds with a fallback, not silence

### Camera Quality (Step 3)
- [ ] Camera on, check console — image size ~30-50KB per frame
- [ ] Frames sent at ~1fps, confirmed in console logs
- [ ] Camera flip (front/back) works and sends correct frames
- [ ] Mia can still see and describe what's in frame at low quality

### Timers (Step 4)
**Set:**
- [ ] "Set a 5-minute pasta timer" — timer appears in UI with label and countdown
- [ ] "Set a 10-minute rice timer" while pasta is running — both show, independent countdowns

**Pause/Resume:**
- [ ] "Pause the pasta timer" — countdown stops
- [ ] "Resume the pasta timer" — continues from where it paused
- [ ] Pause, wait 30 seconds, resume — remaining time is correct (not reduced during pause)
- [ ] Pause an already-paused timer — Mia says it's already paused
- [ ] Resume an already-running timer — Mia says it's already running

**Adjust:**
- [ ] "Add 2 minutes to the pasta timer" — remaining time increases by 120 seconds
- [ ] "Remove 1 minute from the timer" — remaining time decreases

**Restart/Cancel/Status:**
- [ ] "Restart the pasta timer" — resets to original duration
- [ ] "Cancel the pasta timer" — timer disappears from UI
- [ ] "How much time is left?" — Mia reports remaining time for all active timers

**Label lookup:**
- [ ] "Pause the pasta timer" (by name, not ID) — finds the right timer
- [ ] Two timers running — actions target the correct one by name

**Expiration:**
- [ ] Timer counts to zero — UI shows expired, Mia announces it
- [ ] Try to pause an expired timer — Mia says it's not found

### Preferences
- [ ] "I'm allergic to nuts" → allergy chip appears on screen
- [ ] "I'm vegetarian" → dietary chip appears
- [ ] Mia responds only ONCE about each preference (no duplicate audio)

### Multiple tools at once
- [ ] "I'm allergic to shellfish and set a 30 second timer for rice" → BOTH chips appear, Mia responds ONCE about both

### Session stability
- [ ] Have a 2+ minute conversation using tools → no crash, no quality loss

### VAD + Audio Quality
- [ ] Start session from phone — Mia greets you clearly
- [ ] Say a full sentence — Mia understands correctly (not random languages in transcript)
- [ ] Mia speaks a full response without `(interrupted)` in the log
- [ ] Make kitchen noise (clap, tap counter) while Mia is talking — she keeps talking (not chopped)
- [ ] Speak normally to interrupt Mia — she stops and listens (LOW sensitivity still allows real speech)
- [ ] Check log: no `(interrupted)` unless you actually spoke
- [ ] Check log: User transcription matches what you actually said

### Log verification
- [ ] Log file shows "User:" and "Mia:" lines
- [ ] Log file shows tool calls and results
