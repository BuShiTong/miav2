# Mia Demo Video Script

## What Judges Score (and how this script hits each)

| Criteria | Weight | How We Hit It |
|----------|--------|---------------|
| Innovation & Multimodal UX | 40% | Barge-in, persona/voice, camera vision, hands-free cooking flow |
| Technical Implementation | 30% | Mention Vertex AI, Cloud Run, server-side validation, grounding, compression |
| Demo & Presentation | 30% | Clear problem/solution, architecture proof, live software (no mockups) |

---

## The Order of Ideas

1. **Hook**:Relatable problem (dirty hands + phone + cooking)
2. **Solution in one sentence**:What Mia is
3. **Start session**:Open app, greet Mia, ask for Argentinian pancakes
4. **Google Search grounding**:She looks up a quick recipe (shows search working)
5. **Preferences**:Tell her you're vegetarian + your gf doesn't like bananas (two chips appear)
6. **Let Mia guide the recipe**:Follow along, prep ingredients
7. **Toppings question + barge-in**:Ask about toppings, interrupt her mid-answer
8. **Timers**:Set a couple random timers while cooking
9. **Camera on**:Ask Mia to check the pancake consistency
10. **Banana test**:Show her a banana, ask if it's a good topping (memory test)
11. **Camera off**:Voice-controlled off
12. **Timer goes off**:Let it ring, Mia announces it
13. **Tech under the hood**:Quick, casual, at the end
14. **Close with identity**:Not a chatbot, a cooking companion

---

## Script (~3:50)

### [0:00 - 0:20] THE HOOK

*You talking to camera (or voiceover while showing the app). Casual, like telling a friend.*

> So here's the thing. Every time we cook something new, we end up with a phone in one hand and a spatula in the other. Scrolling through a recipe, hands covered in flour, trying not to drop the phone in the pan.
>
> That's why we built Mia. She's a cooking assistant you just... talk to. Like having a friend in the kitchen who actually knows what they're doing.

*Open the app on screen. Judges see the UI.*

---

### [0:20 - 1:00] START SESSION + SEARCH + PREFERENCES

*Tap Start. Connection animation plays. Mia greets you.*

> Hey Mia! I want to make some Argentinian pancakes with dulce de leche. Can you find me a quick, simple recipe?

*Mia searches (Google Search grounding fires). She comes back with a recipe. Let her talk for a bit:judges see this is real-time, not scripted answers.*

*Once she's given you the basics, drop the preferences naturally:*

> Oh by the way, I'm vegetarian. And my girlfriend doesn't like bananas, so keep those out.

*Two preference chips appear on screen. Hold the phone still for a second so judges can see them.*

**What judges see here:**
- Google Search grounding (real-time recipe lookup)
- Preference memory (two chips, two different types: dietary + dislike)
- Visual feedback (chips on screen)
- Natural conversation flow (not a command-line interface)

---

### [1:00 - 1:45] FOLLOWING THE RECIPE + BARGE-IN

*Let Mia guide you through prep. Actually start getting ingredients out, mixing, etc.*

*When she's explaining the recipe steps, ask about toppings:*

> What are some good toppings I could put on these?

*While Mia is listing toppings, interrupt her mid-sentence:*

> Wait, how much dulce de leche do I need for each one?

*She stops, answers your question, moves on. That's the barge-in. Don't call attention to it:it just works.*

**What judges see here:**
- Barge-in works naturally (Live Agent requirement:"Does the agent handle interruptions naturally?")
- Mia has a distinct voice/persona (not robotic TTS)
- The interaction is fluid, not disjointed or turn-based
- You're actually cooking (real use case)

---

### [1:45 - 2:10] TIMERS

*While prepping, set timers casually:*

> Mia, set a timer for 2 minutes for the first pancake.

*Timer appears on screen. Mia confirms.*

> And set another one for 5 minutes for the dulce de leche to warm up.

*Second timer appears. Two timers running at once.*

*Don't explain timers to the camera. Just use them. Let judges see the overlay.*

**What judges see here:**
- Tool use / function calling (multiple timers)
- Visual overlay (timer display)
- Voice-controlled, hands-free
- Multiple concurrent timers

---

### [2:10 - 2:55] CAMERA VISION + BANANA TEST

*While cooking, turn on the camera:*

> Mia, turn on the camera. Can you check the consistency of this pancake?

*Camera activates (voice-controlled tool call). Point your phone at the pan. Let Mia react:she might comment on color, thickness, whether it's ready to flip.*

*After she responds, grab a banana and show it to the camera:*

> Hey Mia, would this be a good topping?

*This is the memory test. She should remember your girlfriend doesn't like bananas and flag it. This is a great moment:it proves preferences persist and affect real-time vision responses.*

*After her response:*

> Mia, turn off the camera.

*Camera turns off by voice.*

**What judges see here:**
- Multimodal: audio + vision combined
- Camera on/off by voice (tool calls)
- Real-time visual understanding (not pre-recorded)
- Preference memory verified through vision (banana test)
- Practical use case (checking cooking progress)

---

### [2:55 - 3:10] TIMER GOES OFF

*By now the 2-minute timer should be close. Let it run. When it beeps, Mia announces it.*

*If the timing doesn't line up perfectly, just keep chatting with Mia until it fires. Or trim dead air in editing.*

**What judges see here:**
- Timer completion works end-to-end (set by voice, visual countdown, audio alert, Mia announces)
- Full lifecycle of a tool-driven feature

---

### [3:10 - 3:50] THE TECH + CLOSE

*Casual tone. Wrapping up, not giving a lecture. Talk while showing the finished pancake or the app.*

> Under the hood, Mia runs on Gemini's Live API with native audio through Vertex AI, deployed on Cloud Run. She uses Google Search for real-time recipe info, server-side validation so she doesn't make stuff up or act on her own, and context compression so she doesn't lose your allergies in long cooking sessions.
>
> She's not a chatbot. She's a cooking companion. And she's completely hands-free, which is kind of the whole point when your hands are covered in batter.

*End on the food or the app screen. Done.*

**What judges see here:**
- Google Cloud Native (Vertex AI + Cloud Run)
- Grounding (Google Search)
- Robustness (server-side validation against hallucinations)
- System design (context compression for long sessions)
- Clear problem/solution story

---

## Features Shown (Checklist)

| Feature | When It Shows | Judge Criteria |
|---------|---------------|----------------|
| Google Search grounding | Recipe lookup | Technical (grounding, robustness) |
| Preference memory (allergy chips) | Vegetarian + no bananas | Innovation (multimodal UX) |
| Barge-in | Interrupt during toppings | Innovation (Live Agent requirement) |
| Timers (multiple) | Two timers set | Technical (tool use) |
| Timer completion | Timer goes off + announcement | Technical (full lifecycle) |
| Camera on by voice | Check pancake | Innovation (multimodal) |
| Vision + memory | Banana test | Innovation + Technical (combined) |
| Camera off by voice | After banana test | Innovation (voice control) |
| Native audio persona | Entire session | Innovation (distinct voice) |
| Affective dialog | Entire session | Innovation (tone-aware) |
| Cloud Run deployment | Closing narration | Technical (Google Cloud Native) |
| Server-side validation | Closing narration | Technical (robustness) |
| Context compression | Closing narration | Technical (system design) |

---

## Tips for Recording

- **Don't memorize word for word.** Know the beats, talk naturally. If you stumble, keep going:it's more authentic.
- **The banana moment is your highlight.** Make sure the banana is visible on camera and give Mia a second to respond. If she remembers the preference, let that land.
- **Let Mia surprise you.** If she says something unexpected or funny, react. That's the best footage.
- **Keep your phone steady** but don't overthink framing. Judges want to see it working, not a film.
- **If something goes wrong** (connection drops, weird response):you have session resumption. Reconnect and keep going, or cut in editing.
- **Speed up dead air**:if Mia takes more than 3 seconds, trim it.
- **Hold still on UI elements**:when chips appear or timers show, pause for a beat so judges can read them.
- **Timer timing**:if the 2-min timer doesn't fire naturally during the camera section, adjust the timer duration when you record. A 1-minute timer might work better for pacing.
