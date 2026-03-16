# We Built a Voice Cooking Assistant That Actually Listens (Most of the Time)

You know that moment when you're elbow-deep in raw chicken, your timer is going off, and you need to know how long to roast potatoes at 200 degrees? You're not going to wash your hands, dry them, unlock your phone, and type a search query. You just need someone in the kitchen who can answer you.

That's why we built Mia.

Mia is a real-time voice cooking assistant. You talk to her like you'd talk to a friend who's great at cooking. She listens, responds in her own voice, walks you through recipes step by step, sets timers, remembers your allergies, and can even look at your food through your phone camera to tell you if those onions are actually caramelized or just sad and sweaty.

We built her for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/) hackathon, and the process of getting her to work taught us more about the current state of voice AI than any documentation ever could.

---

## What It's Like to Use Mia

You open the app on your phone, hit Start, and say something like "hey, I want to make empanadas." Mia greets you differently each time (no canned script) and before diving into the recipe, she asks about allergies or dietary restrictions. Not in a clinical checklist way, more like "anything you can't eat or don't like?"

Then she walks you through it. One step at a time. She waits for you to say you're ready before moving on. If you go quiet because you're kneading dough, she doesn't fill the silence with nervous chatter. She just waits.

Need a timer? "Set a timer for 12 minutes for the filling." Done. It shows up on your screen. Want to know if you can substitute something? Just ask. Turn on the camera and she can see your cutting board. She'll flag if something looks off or tell you your garlic is about to burn.

She sounds like a real person because she is, kind of. The Gemini Live API generates native audio, not text-to-speech. The model thinks in audio and speaks in audio. She has tone, pacing, personality. She reacts to your voice too, thanks to affective dialog. If you sound stressed, she adjusts.

---

## The Stack (Quick Version)

React and TypeScript on the frontend, FastAPI Python backend, all connected through WebSockets. Audio capture and playback use the Web Audio API with AudioWorklets for low-latency streaming. The backend talks to Gemini's Live API on Vertex AI, streaming audio both ways. Deployed on Cloud Run. The whole thing runs in a browser, no app install needed (though we added a PWA manifest so you can stick it on your home screen).

Google Search is built in as a native grounding tool, so when Mia isn't sure about a recipe or a food safety question, she looks it up mid-conversation without breaking the flow.

---

## The Hard Parts

Here's where it gets honest. Building on the Gemini Live API was exciting and deeply frustrating, sometimes in the same five-minute stretch.

**The model talks over itself.** This was our longest-running headache. When a tool call happens (say the user asks to set a timer), the model is supposed to wait for the result before responding. There's a parameter for this called BLOCKING, and another called SILENT for controlling when the model speaks. Except Vertex AI strips both of those parameters from the protobuf before the model ever sees them. The model never knows they were set. So it speaks before the tool runs ("Let me set that for you!"), the tool runs, and then it speaks again ("Your timer is set!"). Double-talk.

We tried an audio gate (muting browser audio during tool execution and unmuting when the real response arrived). It worked on paper. In practice, it created garbled audio fragments. "...on that for you!" instead of full sentences. We went through four iterations of this gate (boolean, state machine, cooldown timers) before accepting that filtering audio client-side was a losing battle.

**The model hallucinates tool calls.** This one was scarier. The user says "I want to make bolognese" and the model decides to save "vegetarian" as a dietary preference. Or it randomly pauses a timer nobody asked to pause. Or resumes one. These aren't edge cases. They happened regularly enough to be a real problem.

**Sessions die every 10 minutes.** Vertex AI drops the WebSocket connection roughly every 10 minutes. Sometimes there's a 60-second GoAway warning, sometimes not. If you're mid-recipe, Mia just vanishes. All context gone.

**Native audio eats tokens for breakfast.** Audio tokens accumulate way faster than text. With the camera on (sending video frames), we measured about 258 tokens per second. The context window fills up in roughly 7.5 minutes. Then the session crashes.

---

## How We Solved Them

**Server-side tool call validation.** Every tool call the model makes passes through a validation layer before executing. The server checks the call against the user's actual speech transcript. What did the user actually say? If the user said "bolognese" and the model is trying to save "vegetarian," that call gets silently rejected. The model receives `{"status": "skipped"}` and moves on without telling the user anything happened. We also batch tool calls in a 300ms window because Gemini fires multiple calls simultaneously, and the transcript often arrives just a few milliseconds after the tool calls do.

**Context window compression.** When the token count hits 100K, the server triggers compression down to 80K. Gemini's Live API handles this natively. You configure the thresholds and it trims older conversation turns. The trick is that regular messages get discarded, but system instruction updates survive compression. So we periodically re-inject the user's allergies and active timers into the system instruction. That way, even after compression wipes the conversation history, Mia still knows you're allergic to shellfish.

**Session resumption.** Vertex AI provides resume tokens when a connection drops. We store them per user and use them to reconnect. The model picks up where it left off, same context, same conversation. Preferences are also cached server-side so they survive even if compression already wiped the original preference-saving conversation turns.

**For double-talk, we accepted it.** After trying and removing the audio gate, we leaned into server-side validation instead. The model might say "let me set that timer" before the tool runs, but at least the tool actually does the right thing. Occasional double-talk with correct behavior beats garbled audio with broken behavior.

---

## What We Learned

Building on a live, streaming, multimodal API is a different kind of engineering. The model is not deterministic. You can't unit test a conversation. The same prompt produces different behavior across sessions. Parameters you set might get stripped by the platform. Features documented in the SDK might not be supported by the server.

The biggest lesson: **don't trust the model to follow instructions. Verify programmatically.** Prompt engineering gets you maybe 30% compliance on behavioral rules. Server-side validation gets you the rest. Every tool call should be treated as untrusted input, same as you'd treat user input in a web app.

The second lesson: **native audio is incredible but expensive.** The voice quality is miles ahead of TTS. It makes the assistant feel alive. But it burns through your context window fast, and you need real infrastructure (compression, resumption, state persistence) to keep a session alive for more than a few minutes.

And the third: **ship what works, not what's elegant.** We went through 50+ documented architectural decisions. We added features and removed them. We tried approaches that sounded great and failed in practice. The decision log in our repo is a graveyard of good ideas that didn't survive contact with reality.

---

## Try It / Read the Code

Mia is open source. The repo has everything: backend, frontend, and the full decision log.

GitHub: [github.com/BuShiTong/miav2](https://github.com/BuShiTong/miav2)

*We created this post for the purposes of entering the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/) hackathon. If you're working with the Gemini Live API and running into the same issues, we hope the decision log in the repo saves you some time.*

#GeminiLiveAgentChallenge
