# Vertex AI Migration Plan

## Final Outcome (March 2026)

Migration is **complete**. The audio gate approach (Strategy #1 below) was implemented, tested across 3 sessions, and **removed** — it caused garbled speech fragments worse than the double-talk it was meant to prevent (see Decision #26).

**What's actually in production:**
- Server-side tool call validation (checks calls against user transcription before executing)
- Tool call buffering (300ms, batches calls + enables validation)
- Timer deduplication (prevents duplicate timers from model double-firing)
- Simplified system prompt (one line: "Only use tools when user explicitly asks")
- Timer status action removed (never accurate), timer labels required (prevent invisible timers)
- "SILENT EXECUTION" removed from tool descriptions (confused the model)

**What was abandoned:**
- Audio gate (all variants: boolean, 4-state machine) — caused garbled fragments
- Verbose tool behavior rules in system prompt — model ignored them ~67% of the time
- Tool response batching (model sends calls sequentially, can't batch)

The research below is preserved as reference for what was investigated and why.

---

## The Problem

On Vertex AI's native audio model (`gemini-live-2.5-flash-native-audio`), the model continues generating audio after emitting a function call instead of pausing. This causes:
- The model narrating what it's about to do ("let me save that for you...")
- Duplicate/repeated speech after receiving the tool result
- Multiple separate responses instead of one clean reply

On AI Studio, this is solved with `behavior: BLOCKING` + `scheduling: SILENT`, but **Vertex AI strips these parameters from the protobuf** — the model never sees them.

---

## What We Want to Achieve

### For allergies, serves, restrictions, and timers:
- The LLM must NOT say anything BEFORE calling the tool
- The LLM should ONLY speak AFTER receiving the tool result
- One clean confirmation per tool call

### For Google Search:
- A filler is desirable BEFORE the tool call ("let me look that up") so the user knows something is happening
- After the tool result, speak the answer once

### For multiple tool calls triggered at once:
- The LLM must respond exactly ONE time
- That single response must include ALL confirmations/results concatenated together
- No duplicates, no multiple replies one after another

### Example flows:
- User: "I'm allergic to nuts" → [silent tool call] → Mia: "Got it, saved your nut allergy."
- User: "What temp for chicken?" → Mia: "Let me look that up." → [search runs] → Mia: "Chicken should reach 165°F internal temp."
- User: "I'm vegetarian and set a 10 minute timer for rice" → [both tools run silently] → Mia: "Saved vegetarian preference and started a 10-minute rice timer."

---

## Recommended Approach: System Prompt + Audio Gate

Based on extensive community research (March 2026 "Hard-Won Patterns" thread, GitHub issues, Perplexity research in `perp6.md`):

- System prompt alone = ~33% effective at preventing narration
- Client-side audio gate = 100% effective
- Combined = guaranteed clean behavior

---

## 10 Workaround Strategies (Research-Based, Best to Worst)

### 1. System Prompt Discipline + Client-Side Audio Gate (RECOMMENDED)
- System prompt tells model to be silent during instant tools, say filler for search
- Client-side: when `toolCall` received, set `muted=True`, drop all audio chunks to browser
- After `toolResponse` sent + new audio generation starts, set `muted=False`
- Community testing: system prompt alone = ~33% effective. Audio gate = 100%.

### 2. System Prompt Discipline Alone
- Add instructions: "Call tools without saying anything. Only speak after receiving results."
- Add "SILENT EXECUTION" to tool descriptions.
- Proven to work in LiveKit issue #4554 (confirmed by developer).
- ~33% effective alone. Not reliable enough on its own.

### 3. Manual Activity Interruption
- Disable auto-VAD: `AutomaticActivityDetection(disabled=True)`
- When `toolCall` arrives → send `ActivityStart` (triggers model interruption)
- Process tool, send `toolResponse`, then send `ActivityEnd`
- Actually stops the model at the API level.
- Downside: you now own ALL turn management.

### 4. Client-Side Audio Gate Alone
- When `toolCall` received → stop forwarding audio to browser
- 100% reliable from user's perspective.
- Downside: model still wastes compute generating audio nobody hears.

### 5. Client Turn Claim to Interrupt
- When `toolCall` received → send `clientContent` with `turnComplete: true`
- Confirmed: this DOES interrupt the model.
- Warning: it's a blunt interrupt, cuts mid-sentence, requires careful audio queue management.

### 6. Fire-and-Forget Tools (No sendToolResponse)
- Execute function but do NOT send `toolResponse`.
- Inject results as `clientContent` text after model's turn is complete.
- Downside: model loses tool result context; search won't work well.

### 7. Full Manual VAD + Tool-Aware Turn Management
- Disable auto-VAD entirely, build custom voice detection.
- Full control but most complex.

### 8. Audio Stream End Signal
- Send `audioStreamEnd: true` on toolCall. Experimental.

### 9. Response Deduplication
- Track pre-tool transcription, filter duplicates. Complex for audio, fragile.

### 10. Offload Tool Orchestration to Text Model
- Use native audio for speech only, tools run on a cheaper text model.
- Avoids the problem but adds architectural complexity.

---

## Key Research Findings

- Vertex AI strips `FunctionResponseScheduling.SILENT` from the protobuf (March 2026 "Hard-Won Patterns" thread)
- `behavior` param on `FunctionDeclaration` is also stripped/ignored on Vertex
- GitHub Issue #1210 (googleapis/js-genai): still open, P2
- GitHub Issue #4554 (livekit/agents): same root cause
- LiveKit drops both `scheduling` and `id` fields when talking to Vertex
- Full research details: see `perp6.md`

### Platform feature comparison:
| Feature | AI Studio | Vertex AI |
|---------|-----------|-----------|
| BLOCKING/NON_BLOCKING behavior | Works | Stripped/ignored |
| SILENT/WHEN_IDLE/INTERRUPT scheduling | Works | Stripped/ignored |
| enable_affective_dialog | Rejected | Supported |
| proactivity (proactive_audio) | Rejected | Supported |

---

## Implementation Tasks

### Task 1: Switch to Vertex AI authentication
**File:** `backend/main.py` (line 62)
- `genai.Client(api_key=...)` → `genai.Client(vertexai=True, project=PROJECT, location=LOCATION)`
- Model name: `gemini-2.5-flash-native-audio-latest` → `gemini-live-2.5-flash-native-audio`
- New env vars: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`
- Auth: uses ADC — run `gcloud auth application-default login` once
- **Verify:** session connects, Mia greets

### Task 2: Update LiveConnectConfig for Vertex AI
**Files:** `backend/main.py` (line 127), `backend/tools.py` (line 243)
- Remove `behavior=types.Behavior.BLOCKING` from all FunctionDeclaration in tools.py
- Remove `scheduling=types.FunctionResponseScheduling.SILENT` from tool responses in main.py
- Try adding `enable_affective_dialog=True` to LiveConnectConfig
- Try adding `proactivity=types.ProactivityConfig(proactive_audio=True)`
- Keep VAD config (LOW sensitivity — prevents false barge-in from kitchen noise)
- **Verify:** no "Unknown name" errors, session connects

### Task 3: Update system prompt with per-tool behavior
**File:** `backend/main.py` (line 65)
- Preferences/timers: "Call the tool directly without saying anything. Only speak AFTER you receive the result."
- Search: "Say a brief filler like 'let me look that up' before calling search_web."
- All tools: "Never narrate what you're about to do. Never repeat yourself after a tool call."
- Multiple tools: "When multiple tool results arrive, acknowledge ALL in one combined response."
- Update tool descriptions in tools.py: add "SILENT EXECUTION" hint to instant tools
- **Verify:** test each tool, observe behavior (won't be 100% — Task 4 fixes the rest)

### Task 4: Implement client-side audio gate
**File:** `backend/main.py` — `downstream()` function (line 224)

```python
# Add to downstream() function:
audio_gated = False
tool_response_sent = False

# When toolCall received:
audio_gated = True
tool_response_sent = False

# When toolResponse is sent:
tool_response_sent = True

# When serverContent has audio:
if audio_gated:
    if tool_response_sent:
        audio_gated = False  # Unmute — this is the real response
        # Forward this audio normally
    else:
        # DROP this audio — it's pre-tool narration
        continue
```

~15 lines of code. Guarantees no duplicate/leaked speech.
- **Verify:** all tool types produce exactly one clean response

### Task 5: Search filler fallback
- Model tries filler naturally via system prompt (before toolCall is emitted)
- If audio gate catches the filler, client plays a pre-recorded filler sound
- Ensures the user ALWAYS hears something before a search wait
- **Verify:** search always has audible filler

### Task 6: Update decisions.md
Log the Vertex AI fork decision with rationale.

---

## Verification Plan

1. Start session → Mia greets naturally
2. "I'm allergic to nuts" → silent save, one clean confirmation
3. "Set a 5-minute timer for pasta" → silent set, one clean confirmation
4. "What temp should I cook chicken to?" → filler, search, one answer
5. "I'm vegetarian and set a 10-minute timer for rice" → ONE consolidated response
6. "I serve 4 people" → silent save, one confirmation
7. Check session logs → no duplicate tool responses, no double audio
8. Test barge-in during response → still works
9. Test camera → still works

---

## Risks and Mitigations

1. **enable_affective_dialog / proactivity might be rejected** — Just remove them. Non-blocking.
2. **Audio gate timing** — Unmute on first audio chunk AFTER toolResponse, not on turnComplete.
3. **Search filler timing** — Filler should play BEFORE toolCall. If model bundles them, client-side filler fallback handles it.
4. **Multiple tools** — System prompt + audio gate ensures only the final combined response is heard.
