# Testing Checklist — Audio Only Mode

Test every item. Check the box when it passes. Write notes if something is wrong.
After each session, share the log file from `backend/logs/` for review.

**How to start:** Run the backend, open the frontend, select "Audio Only", enter code `cookwithmia26`, click Start.

---

## 1. Connection + Greeting

- [ ] **Backend starts clean**
  Start the backend. No errors in the terminal.

- [ ] **App loads**
  Open the app in Chrome. You see the welcome screen with "Audio Only" selected.

- [ ] **Access code works**
  Type `cookwithmia26`, click "Start Cooking".
  You hear a connection sound. Button changes to "Connecting..." then "Listening...".

- [ ] **Mia greets you**
  Within 2-3 seconds, Mia says something like "Hey! What are we cooking?"
  She sounds natural. No robotic artifacts. No cut-off words.

- [ ] **Wrong access code**
  Stop. Enter `wrongcode`. Click Start.
  You see an error message. You can fix the code and try again.

---

## 2. Basic Conversation

- [ ] **Mia understands you**
  Say: "I'm making spaghetti bolognese tonight."
  Mia responds with something relevant about pasta or bolognese. Not random/unrelated.

- [ ] **Mia stays concise**
  Mia's response is short (roughly 5-35 words). Not a long lecture.

- [ ] **Back-and-forth works**
  Have 3-4 exchanges. Each response is relevant to the previous one.
  Mia remembers what you said earlier in the conversation.

---

## 3. Preferences

- [ ] **Allergy**
  Say: "I'm allergic to nuts."
  Mia saves it silently (no "let me save that"), then confirms once: something like "Got it, no nuts."
  A preference chip appears on screen.

- [ ] **Dietary restriction**
  Say: "I'm vegetarian."
  Same behavior: silent save, one confirmation, chip appears.

- [ ] **Serving size**
  Say: "I'm cooking for 4 people."
  Same behavior: silent save, one confirmation, chip appears.

- [ ] **Skill level**
  Say: "I'm a beginner cook."
  Same behavior: silent save, one confirmation, chip appears.

- [ ] **No double-talk on preference**
  For each preference above: Mia speaks ONCE. Not twice. No "let me save that" before the confirmation.
  Check the log — only one "Mia:" line per preference.

---

## 4. Timers — Set

- [ ] **Set a timer by voice**
  Say: "Set a 2-minute timer for pasta."
  Mia confirms once (e.g., "Pasta timer set for 2 minutes").
  Timer appears on screen with label "pasta" and counting down from 2:00.

- [ ] **Set a second timer**
  Say: "Set a 30-second timer for garlic."
  Second timer appears. Both timers count down independently.

- [ ] **No double-talk on timer set**
  Mia speaks ONCE per timer. No "I'm setting a timer" before the confirmation.

---

## 5. Timers — Pause & Resume

- [ ] **Pause a timer**
  Say: "Pause the pasta timer."
  Timer stops counting down. Mia confirms (e.g., "Pasta timer paused").

- [ ] **Time doesn't tick while paused**
  Wait 10 seconds. The timer still shows the same time it was at when paused.

- [ ] **Resume a timer**
  Say: "Resume the pasta timer."
  Timer starts counting down again from where it was. Mia confirms.

- [ ] **Pause an already-paused timer**
  Say: "Pause the pasta timer" again.
  Mia says it's already paused. No error, no crash.

- [ ] **Resume an already-running timer**
  Say: "Resume the pasta timer" again after it's already running.
  Mia says it's already running. No error, no crash.

---

## 6. Timers — Adjust

- [ ] **Add time**
  Say: "Add 1 minute to the pasta timer."
  Timer jumps up by 60 seconds. Mia confirms.

- [ ] **Remove time**
  Say: "Take 30 seconds off the pasta timer."
  Timer drops by 30 seconds. Mia confirms.

---

## 7. Timers — Restart & Cancel

- [ ] **Restart a timer**
  Say: "Restart the pasta timer."
  Timer resets to its original duration and starts counting down again. Mia confirms.

- [ ] **Cancel a timer**
  Say: "Cancel the garlic timer."
  Timer disappears from screen. Mia confirms.

- [ ] **Cancel a timer that doesn't exist**
  Say: "Cancel the chicken timer." (when there's no chicken timer)
  Mia says something like "I don't see that timer." No crash.

---

## 8. Timers — Status & Expiry

- [ ] **Ask for timer status**
  Say: "How much time is left?"
  Mia reports the remaining time for all active timers.

- [ ] **Timer expires**
  Let a timer count down to zero.
  You hear a beep sound (3 beeps). Phone vibrates (if supported).
  Mia announces the timer is done (e.g., "Your pasta timer's up!").
  Timer disappears from screen after about 10 seconds.

- [ ] **Try to pause an expired timer**
  After a timer expires, say: "Pause the pasta timer."
  Mia says the timer is not found. No crash.

---

## 9. Timers — Label Lookup

- [ ] **Find timer by name**
  Set two timers (e.g., "pasta" and "rice"). Say: "Pause the rice timer."
  The correct timer pauses (rice, not pasta).

- [ ] **Adjust specific timer by name**
  Say: "Add 2 minutes to the pasta timer."
  Only the pasta timer changes. Rice timer unaffected.

---

## 10. Google Search

- [ ] **Search with filler**
  Say: "What temperature should I cook chicken to?"
  Mia says something like "Let me look that up" (filler).
  Button shows "Searching...".
  After a few seconds, Mia gives the answer (should mention 165°F / 74°C).

- [ ] **No search for basic questions**
  Say: "How do I dice an onion?"
  Mia answers directly from her own knowledge (no search indicator).

- [ ] **Search result is spoken once**
  After a search, Mia speaks the answer ONCE. Not twice.

- [ ] **Search failure is handled**
  (Hard to test, but if it happens): Mia should still respond, saying something like "I couldn't look that up, but from what I know..."

---

## 11. Multiple Tools at Once

- [ ] **Preference + timer together**
  Say: "I'm allergic to shellfish and set a 30-second timer for rice."
  BOTH things happen: preference chip appears AND timer starts.
  Mia responds ONCE about both (e.g., "Noted shellfish allergy, and rice timer's set for 30 seconds").

- [ ] **Two preferences at once**
  Say: "I'm vegan and cooking for 2."
  Both preferences saved. Mia confirms both in one response.

- [ ] **No multiple separate responses**
  For multi-tool commands: Mia speaks exactly ONE time, covering everything.

---

## 12. Barge-In (Interrupting Mia)

- [ ] **Interrupt mid-sentence**
  Wait for Mia to speak a long response. While she's talking, say: "Wait, actually—"
  Mia stops immediately. No overlap. She listens to you.

- [ ] **Continue after interrupt**
  After interrupting, say something new (e.g., "Can I use olive oil instead?").
  Mia responds to your new question. No confusion from the interrupted response.

- [ ] **Kitchen noise doesn't interrupt**
  While Mia is talking, clap your hands or tap the counter.
  Mia keeps talking. She's NOT interrupted by noise (LOW sensitivity working).

- [ ] **Actual speech does interrupt**
  While Mia is talking, say a clear sentence: "Hold on a second."
  Mia stops. She heard you.

---

## 13. Audio Gate (Tool Silence)

These tests verify the audio gate is working — the feature that prevents Mia from talking during tool calls.

- [ ] **Silent preference save**
  Say: "I'm allergic to dairy."
  Between when you stop talking and Mia's confirmation, there should be SILENCE.
  No "let me save that" or narration before the confirmation.

- [ ] **Silent timer set**
  Say: "Set a 1-minute timer for eggs."
  Same thing: silence between your request and Mia's confirmation. No narration.

- [ ] **Check the logs**
  After testing a preference or timer, look at the session log.
  You should see: "Audio gate ACTIVATED" then "Audio gate DEACTIVATED (dropped X chunks)".
  If X > 0, the gate caught and dropped narration audio. That's good — it worked!

---

## 14. Affective Dialog (New Vertex Feature)

- [ ] **Excited tone**
  Say something enthusiastically: "Oh my god, this smells AMAZING!"
  Does Mia's response match your energy? (She should sound upbeat/excited too.)

- [ ] **Frustrated tone**
  Say something frustrated: "Ugh, I think I burned it."
  Does Mia's response feel empathetic? (She should sound supportive, not cheerful.)

Note: This is subtle. Mark what you notice, even if it's "no difference."

---

## 15. Session Stability

- [ ] **2+ minute conversation**
  Have a natural cooking conversation for at least 2 minutes.
  Use preferences, timers, and search along the way.
  No crashes, no silence gaps, no quality loss over time.

- [ ] **5+ minute conversation**
  Extended session. Does audio quality stay the same?
  Do timers still work correctly after several minutes?

- [ ] **Rapid commands**
  Say several things quickly one after another:
  "I'm gluten free. Set a 1-minute timer for test. What temp for salmon?"
  All three things should work: preference saved, timer set, search runs.

---

## 16. Session Stop & Restart

- [ ] **Clean stop**
  Click Stop. Welcome screen reappears. Timers disappear.
  No audio plays after stopping.

- [ ] **Restart after stop**
  Click Start again with the same code.
  New session begins. Mia greets you fresh. Previous conversation is gone.

- [ ] **Rapid stop/start**
  Click Stop, then immediately click Start.
  New session starts cleanly. No leftover audio from previous session.

---

## 17. Screen & Wake Lock

- [ ] **Screen stays on**
  During an active session, leave your phone/laptop idle for 30 seconds.
  The screen should NOT dim or lock (wake lock is active).

- [ ] **Screen locks after stop**
  Click Stop. Now the screen is allowed to dim normally.

---

## 18. Tab Switching

- [ ] **Switch away and back**
  During a conversation, switch to another browser tab. Wait 5 seconds. Switch back.
  Audio resumes. Conversation continues. No crash.

---

## 19. Reconnection

- [ ] **Auto-reconnect**
  If the connection drops (you'll see "Reconnecting..." on the button):
  Does it reconnect automatically within a few seconds?
  After reconnecting, can you continue talking?

Note: This is hard to test on purpose. Just note if it happens naturally.

---

## 20. Voice Quality

- [ ] **Clear audio**
  Mia's voice is clear. No static, no echo, no distortion.

- [ ] **Natural pace**
  Mia speaks at a natural speed. Not too fast, not too slow.

- [ ] **No cut-off words**
  Mia finishes her sentences. Words aren't chopped in the middle.
  (Exception: when YOU interrupt her — that's expected.)

- [ ] **Transcription accuracy**
  Check the session log. Under "User:" lines, does the transcription match what you actually said?

---

## 21. Goodbye Flow

- [ ] **End the conversation**
  Say: "Thanks, I think we're done!" or "Goodbye!"
  Mia says a warm goodbye (e.g., "Enjoy your meal! Come back anytime.").

---

## 22. Log Verification

After testing, open the latest log file from `backend/logs/`.

- [ ] **Transcriptions logged**: You see "User:" and "Mia:" lines matching the conversation
- [ ] **Tool calls logged**: You see "Tool call received:" for each tool used
- [ ] **Tool results logged**: You see "Tool result:" with success status and timing
- [ ] **Audio gate logged**: You see "Audio gate ACTIVATED" and "Audio gate DEACTIVATED"
- [ ] **No duplicate responses**: Each tool call has exactly one "Mia:" response after it
- [ ] **No errors**: No stack traces or ERROR lines (unless testing error cases)

---

## Summary Scorecard

| Section | Pass | Fail | Notes |
|---------|------|------|-------|
| 1. Connection + Greeting | | | |
| 2. Basic Conversation | | | |
| 3. Preferences | | | |
| 4. Timers — Set | | | |
| 5. Timers — Pause & Resume | | | |
| 6. Timers — Adjust | | | |
| 7. Timers — Restart & Cancel | | | |
| 8. Timers — Status & Expiry | | | |
| 9. Timers — Label Lookup | | | |
| 10. Google Search | | | |
| 11. Multiple Tools at Once | | | |
| 12. Barge-In | | | |
| 13. Audio Gate | | | |
| 14. Affective Dialog | | | |
| 15. Session Stability | | | |
| 16. Session Stop & Restart | | | |
| 17. Screen & Wake Lock | | | |
| 18. Tab Switching | | | |
| 19. Reconnection | | | |
| 20. Voice Quality | | | |
| 21. Goodbye Flow | | | |
| 22. Log Verification | | | |
