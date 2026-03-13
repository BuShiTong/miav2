<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# I'm building a real-time voice agent using Google's Gemini Live API (BidiGenerateContent) with native audio. I'm currently using the ADK (Agent Development Kit) but considering switching to the raw Python SDK (google-genai) for more control.

Please give me a comprehensive list of Gemini Live API features, parameters, and anything else that are available when using the raw Python SDK (google-genai) directly, but are NOT accessible through ADK (google-adk). Specifically:
Tool/function calling features: NON_BLOCKING behavior, SILENT/WHEN_IDLE/INTERRUPT scheduling, will_continue on FunctionResponse, any other tool-related parameters
Audio/voice control: audio format options, voice selection, speech detection settings, turn-taking signals, barge-in control
Session management: session resumption, context window control, manual turn management
Generation config: any parameters available in LiveConnectConfig or BidiGenerateContentSetup that ADK's RunConfig doesn't expose
Activity signals, proactive audio, or any other Live API capabilities
For each feature, briefly explain what it does and when it would be useful for a voice agent.
As of March 2026, comparing google-adk v1.26.0 with google-genai SDK. Please include sources from official docs.

Using the raw `google-genai` SDK with Gemini Live gives you significantly more control than ADK’s `RunConfig`, especially around async tools, turn-taking, and Live-specific capabilities such as proactivity, affective dialog, and context management.[^1][^2][^3][^4][^5][^6][^7][^8][^9]

Below is a feature-by-feature rundown of what you gain with `google-genai` Live (via `LiveConnectConfig` / `BidiGenerateContentSetup`) that ADK 1.x does **not** expose as first‑class, documented knobs in `RunConfig` or the streaming APIs.

***

## How ADK and google‑genai relate

- ADK sits on top of the same underlying Gemini APIs and schema (including function-calling, `Behavior`, `FunctionResponse.scheduling`, etc.).[^9]
- For Live/Bidi, ADK’s public runtime surface is essentially `RunConfig` (speech config, basic streaming mode, simple audio transcription) plus its own “LiveRequestQueue + run_live()` and tool abstractions.[web:10][web:103]
- The raw `google-genai` SDK exposes the full Live wire protocol through `client.aio.live.connect(..., config=LiveConnectConfig(...))` and low‑level streaming messages (including realtime input, setup, tool calls, tool responses, and activity signals).[^31][^32][^57][^59][^64]

Everything below is about capabilities you can explicitly configure in `google-genai` Live that **don’t have an equivalent documented flag in ADK’s `RunConfig` or Live docs**.

***

## Tool / function-calling controls

### 1. `Behavior.NON_BLOCKING` on function declarations

- **What it is (raw SDK)**
In the core Gemini function-calling schema, each `FunctionDeclaration` has a `behavior` field: `BLOCKING` or `NON_BLOCKING`.[^7][^8]
    - `BLOCKING`: model pauses until the function response arrives before continuing the conversation.
    - `NON_BLOCKING`: model keeps conversing while tool(s) run; function responses are merged back in later.[^8][^7]
- **How you use it in `google-genai`**
In the SDK types this is `genai.types.Behavior.NON_BLOCKING` on a function declaration or tool config, and is also supported for Live API tools (see “Tool use with Live API”).[^10][^11][^12][^13][^14][^7]
- **Status in ADK**
ADK docs describe *long‑running tools* implemented via ADK events (`long_running_tool_ids`) and multiple `FunctionResponse` parts, but don’t expose a way to set `Behavior.NON_BLOCKING` explicitly or document it as a supported knob on function tools.[^15][^16][^17][^18]
The YAML `AgentConfig` schema includes this field because it mirrors the underlying API, but ADK’s public Python function-tool APIs don’t show a way to set `behavior`.[^9]
- **Why it matters for voice**
Lets you kick off slow tools (DB queries, long external APIs, background actions) without freezing the conversation—e.g., “I’ll start uploading your files; meanwhile, what project is this for?”—and then inject results when they’re ready.

***

### 2. `FunctionResponse.scheduling` (`SILENT` / `WHEN_IDLE` / `INTERRUPT`)

- **What it is (raw SDK)**
For `NON_BLOCKING` tools, a `FunctionResponse` contains `scheduling`:[^11][^12][^19][^14][^7][^8]
    - `SILENT`: add tool result to context only, no immediate generation.
    - `WHEN_IDLE`: queue the result and let the model respond next time it’s idle.
    - `INTERRUPT`: immediately interrupt current generation and respond using the new tool result (hard barge‑in from a tool).
- **How you use it**
In Python:

```python
function_response = types.FunctionResponse(
    id=fc.id,
    name=fc.name,
    response={
        "result": "ok",
        "scheduling": "INTERRUPT",  # or WHEN_IDLE / SILENT
    },
)
```[^11][^12][^19][^14]  

```

- **Status in ADK**
ADK event APIs expose `FunctionResponse` parts but don’t document any way to set `scheduling` from your tool code; examples for function tools simply set a JSON `response` dict and let ADK send it.[^16][^17][^18][^15]
The AgentConfig schema *describes* `scheduling` and notes that it only applies to `NON_BLOCKING` calls, but that’s just reflecting the low-level API; there’s no ADK-level API or example for *choosing* SILENT/WHEN_IDLE/INTERRUPT per response.[^9]
- **Why it matters for voice**
Lets tools decide how disruptive they should be:
    - `SILENT` for background updates (e.g., logging metrics).
    - `WHEN_IDLE` for “update me when you’re done speaking.”
    - `INTERRUPT` for urgent things (“Your payment failed—please update your card now”).

***

### 3. `FunctionResponse.will_continue` (generator-style tool streams)

- **What it is (raw SDK)**
`FunctionResponse` has a `will_continue` boolean indicating whether more responses for the same function call will follow (generator semantics). It only applies to `NON_BLOCKING` calls; if `false`, future responses are ignored and an empty `response` with `will_continue=false` is allowed as a pure “finished” signal.[^20][^21][^7][^8][^9]
- **How you use it**
At the protocol level and in SDKs, you can send a series of responses for a single `function_call.id`, marking intermediate ones with `will_continue=true` and the final one with `will_continue=false`.[^8][^20][^9]
- **Status in ADK**
    - ADK’s schema and some release notes recognize `will_continue` and recent versions started “checking `will_continue` for streaming function calls.”[^22][^23][^24][^9]
    - However, ADK’s public function-tool docs describe a higher-level “long-running tools” pattern that relies on status fields in your JSON and ADK’s event logic, not on you explicitly manipulating `will_continue`.[^18][^15]
    - There is no documented way in ADK Python to mark a response as `will_continue=true` or choose `scheduling` alongside it; ADK abstracts that away.
- **Why it matters for voice**
Lets a tool stream partial progress or incremental results (e.g., “10%… 30%… 90%… done”) while the conversation continues, and lets the agent know exactly when the stream for that call is over.

***

### 4. Tool-config knobs (function-calling modes and limits) at Live level

These exist in the generic function-calling API and are used by Live when tools are attached:

- `FunctionCallingConfig.mode` (`AUTO`, `ANY`, `NONE`, `VALIDATED`) and `allowed_function_names`.[^7][^8]
- `AutomaticFunctionCallingConfig` (`disable`, `maximum_remote_calls`), controlling how much of the call→execute→call loop the SDK does for you automatically.[^25][^7]

**Raw SDK:** Exposed directly via `GenerateContentConfig.tool_config` and `automatic_function_calling` for normal calls, and conceptually the same config applies to Live when you pass tools in `LiveConnectConfig.tools`.[^26][^5][^3][^25]

**ADK:**

- You can pass a `generate_content_config` in `AgentConfig`, but ADK’s Live docs don’t show any way to tune Live‑session tool mode or automatic function‑calling limits independently of ADK’s own tool orchestration.[^15][^16][^9]
- ADK focuses on its own abstractions (function tools, agent‑as‑tools, long‑running tools) rather than exposing the low‑level `FunctionCallingConfig` surface.

**Why it matters for voice**

- Fine-grained control over whether the model *must* call tools, can choose freely, or is barred from calling them at certain times.
- Can reduce latency and “tool thrashing” in real‑time conversations by clamping max automatic tool turns.

***

## Audio / voice / real‑time input controls

### 5. Low-level audio format \& transport control

- **What raw Live supports**
With `google-genai` Live you send audio explicitly as `types.Blob` with MIME type and sample rate, e.g. `mime_type="audio/pcm;rate=16000"` for 16‑kHz mono PCM, or base64‑encoded WAV data.[^27][^5][^28]
You control how you capture, resample, and chunk audio before passing it into `session.send_realtime_input(...)`.[^5][^27]
- **ADK**
ADK’s streaming guide emphasizes that it handles WebSocket setup, audio capture/encoding, and VAD for you; user‑facing config is just `speech_config` and `response_modalities`.[^29][^30][^1]
There’s no documented way to change the underlying Live audio MIME type, resampling behavior, or packetization; that’s managed inside ADK’s runner pipeline.
- **Why it matters for voice**
If you’re integrating with custom audio pipelines (e.g., telephony codecs, browser media servers, ESP32 mics), direct control over audio MIME type and buffering makes it much easier to keep latency predictable and avoid unnecessary re-encoding.

***

### 6. Realtime input configuration \& barge‑in tuning (`RealtimeInputConfig`)

- **Raw SDK / Live**
`BidiGenerateContentSetup` includes `realtime_input_config`, which lets you configure:[^2][^31][^4][^8]
    - `automatic_activity_detection` (VAD-like behavior) including `silence_duration_ms` and `disabled` (turn it off if you send manual signals).[^4][^2][^8]
    - `activity_handling` enum:
        - `START_OF_ACTIVITY_INTERRUPTS`: new user activity interrupts the model’s output (classic “barge‑in”).
        - `NO_INTERRUPTION`: user activity doesn’t cut off the model’s speech.[^2][^8]
    - `turn_coverage` (whether a turn includes only activity segments or all realtime input).[^8]

Those configuration options are surfaced in Live docs and examples using `LiveConnectConfig.realtime_input_config`.[^32][^6][^4]
- **ADK**
ADK RunConfig has no fields for `realtime_input_config`, `activity_handling`, or `silence_duration_ms`.[^30][^1]
ADK’s bidi guide explains that Live does VAD and interruptions and that users can interrupt the agent mid‑turn, but how barge‑in works is determined by Live defaults, not by any RunConfig surface.[^30][^2]
- **Why it matters for voice**
    - Tight control over barge‑in: some apps want aggressive interruption (smart speakers), others want “no barge in” (compliance read‑outs).
    - Adjusting silence thresholds to trade off responsiveness vs accidental cut‑offs, especially in noisy environments or for long pauses.

***

### 7. Manual activity signals (`ActivityStart` / `ActivityEnd`)

- **Raw SDK / Live**
When you disable automatic activity detection, you can manually send activity boundaries: `ActivityStart`, streaming audio, then `ActivityEnd` via `session.send_realtime_input(...)`.[^4]
Example from the Live guide:[^4]
    - Config:

```python
config = {
    "response_modalities": ["TEXT"],
    "realtime_input_config": {"automatic_activity_detection": {"disabled": True}},
}
```

    - Usage:

```python
await session.send_realtime_input(activity_start=types.ActivityStart())
await session.send_realtime_input(
    audio=types.Blob(data=audio_bytes, mime_type="audio/pcm;rate=16000")
)
await session.send_realtime_input(activity_end=types.ActivityEnd())
```

- **ADK**
ADK’s Live abstraction doesn’t expose `ActivityStart` / `ActivityEnd` as user calls; you push messages into its `LiveRequestQueue` and it decides how to map them into Live messages.[^30]
There’s no documented way to override automatic activity detection or send explicit activity markers.
- **Why it matters for voice**
    - Essential if you already know your utterance boundaries (e.g., from a telephony stack, push‑to‑talk, or “press and hold to speak” UI).
    - Allows exact synchronization between what the user intends as a “turn” and what the model sees as one.

***

### 8. Input vs output audio transcription control

- **Raw Live API**
Live capabilities include separate `inputAudioTranscription` and `outputAudioTranscription` in the Live config, allowing you to ask the server to transcribe what the *user* said and/or what the *model* said.[^33][^27][^5]
- **ADK**
ADK’s `RunConfig` has an `output_audio_transcription` field (documented via `AudioTranscriptionConfig`), but there is no corresponding input‑transcription field in `RunConfig`.[^1]
That means you can easily get text for the model’s audio replies, but not first‑class, documented input transcriptions from Live via ADK alone.
- **Why it matters for voice**
    - Input transcripts are handy for analytics, debugging, or rendering “what the user just said” in the UI.
    - Output transcripts help for accessibility and multimodal UIs, but often you want both for full logging and supervision.

***

## Session management \& context window control

### 9. Session resumption (`session_resumption`)

- **Raw Live / `google-genai`**
`BidiGenerateContentSetup` includes a `session_resumption` field. When supplied, Live periodically sends `SessionResumptionUpdate` messages so a client can reconnect with a token when the WebSocket is dropped.[^31][^28][^33][^2]
- **ADK**
ADK docs explicitly distinguish between an ADK `Session` (long‑lived conversation state) and a Live API session (transient WebSocket), and describe that ADK will *recreate* Live sessions when you call `run_live()` but do not expose Live’s `session_resumption` mechanism or resumption handle to user code.[^30]
RunConfig does not have any field corresponding to `session_resumption`.[^1]
- **Why it matters for voice**
    - If you run your own Live connection (e.g., low‑latency server<–>browser), you can survive network blips without losing in‑flight context or having to rebuild conversation history manually.
    - Matters for mobile or weak networks where WebSockets drop frequently.

***

### 10. Context window compression (`context_window_compression`)

- **Raw Live**
The Live reference and session management docs describe a `context_window_compression` config that tells the server to actively compress or slide the context window (e.g., sliding window) to keep the conversation within a target size.[^31][^3][^2]
- **ADK**
No documented RunConfig or agent‑level field for `context_window_compression`; the Live capabilities docs show this being configured via `LiveConnectConfig` in raw `google-genai` examples.[^3][^33]
ADK handles its own persistent `Session` store and summarizes/forwards history, but you cannot directly use Live’s server‑side context compression knobs from ADK.
- **Why it matters for voice**
    - For long-lived conversations, offloading summarization/compression to the server can keep latency low and reduce token usage without writing your own summarization layer.
    - Gives predictable memory behavior for kiosk/assistant scenarios where the device stays “on” all day.

***

## Live‑specific generation config beyond ADK’s `RunConfig`

### 11. Affective dialog (`enable_affective_dialog`)

- **Raw SDK / Live**
`LiveConnectConfig` has `enable_affective_dialog`, which makes the model detect emotional state and adapt response tone; it’s only supported on specific native‑audio dialog models and on the `v1alpha` Live API.[^34][^35][^6][^4]
Examples show:

```python
config = types.LiveConnectConfig(
    response_modalities=["AUDIO"],
    enable_affective_dialog=True,
    speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")
        ),
    ),
)
```[^34][^35]  

```

- **ADK**
`RunConfig` only exposes generic `speech_config` and `response_modalities`; there is no ADK field for `enable_affective_dialog` and no mention of affective dialog in ADK Live docs.[^29][^1][^30]
- **Why it matters for voice**
    - For customer support, coaching, or mental‑health‑adjacent experiences, affective dialog can automatically soften responses when the user sounds frustrated, or mirror excitement, without hand‑coding emotion classification.

***

### 12. Proactive audio (`proactivity.proactive_audio`)

- **Raw SDK / Live**
Live supports a `proactivity` / `ProactivityConfig` in `LiveConnectConfig` with `proactive_audio: true` to let the model decide *whether* to respond at all—e.g., only when clearly addressed, or only on specific topics.[^35][^6][^4]
Example:

```python
config = LiveConnectConfig(
    response_modalities=["AUDIO"],
    proactivity=ProactivityConfig(proactive_audio=True),
)
```[^6]  

```

- **ADK**
ADK docs for Live streaming don’t mention `proactivity` or proactive audio. `RunConfig` has no field for it; the model is expected to respond whenever prompted through ADK’s run loop.[^29][^1][^30]
- **Why it matters for voice**
    - Crucial for always‑listening devices: you often want the agent *not* to reply to background chatter, or to “listen but stay quiet” until obviously addressed.
    - Reduces UX noise in multi‑speaker environments (open offices, living rooms).

***

### 13. Live‑level media / rendering options (e.g., `media_resolution`, `image_encode_options`)

- **Raw SDK**
Live and LiveConnectConfig support extra tuning such as `media_resolution` (low/medium/high media quality) and `image_encode_options` for how inline images are encoded over the socket, exposed in `LiveConnectConfig` and related SDK types.[^36][^33][^32]
- **ADK**
`RunConfig` has no `media_resolution` or encoding controls; the Live API configuration it uses internally is not customizable from ADK’s public config surface.[^1][^30]
- **Why it matters for voice / multimodal**
    - If your “voice agent” is actually voice + video (e.g., kiosk or AR), controlling media resolution is key to getting acceptable bandwidth and latency.

***

## Activity signals, turn-taking and server messages

### 14. Direct access to Live server messages (`turn_complete`, `interrupted`, `generation_complete`, tool call cancellation)

- **Raw Live / `google-genai`**
`BidiGenerateContentServerContent` includes:[^28][^27][^33][^2]
    - `turn_complete`: signal that the model is done with a turn.
    - `interrupted`: user/Client interruption; indicates you should stop playback and clear audio queue.
    - `generation_complete`: all tokens are generated; may precede `turn_complete` when server assumes real‑time playback.[^2][^31]
    - `BidiGenerateContentToolCallCancellation` messages to tell you which pending tool calls should be canceled when the user interrupts.[^37][^2]

In `google-genai`, you receive these as structured fields on `LiveServerMessage` / `LiveServerContent`, and examples show how to wait for `turnComplete` to implement manual turn boundaries.[^27][^5][^33]
- **ADK**
ADK’s `Event` object wraps LLM responses and hides most of the Live‑specific server message detail, exposing primarily `content`, `partial`, function calls/responses, and ADK‑specific metadata.[^17][^30]
It doesn’t document any direct access to `generation_complete`, `interrupted`, or tool call cancellation IDs from Live; ADK handles those internally to manage streaming and history.
- **Why it matters for voice**
    - If you run your own audio player, it’s very useful to react to `interrupted` (to flush the TTS buffer) and `turn_complete` (to know when safe to accept next utterance).
    - Tool-call cancellations matter when tool invocations have side effects (payments, device control); you might want to undo or reconcile on cancellation.

***

## Summary: when to drop to `google-genai` Live

If you need any of the following, you’re better off using the raw `google-genai` Live APIs (and possibly wrapping them in your own mini-runtime) instead of staying purely in ADK:

- True async tools with explicit `Behavior.NON_BLOCKING`, `will_continue`, and `scheduling` (`SILENT` / `WHEN_IDLE` / `INTERRUPT`).[^7][^8][^9]
- Fine-grained barge‑in and VAD behavior via `RealtimeInputConfig` (including manual `ActivityStart` / `ActivityEnd`).[^2][^4][^8]
- Input audio transcription, affective dialog, and proactive audio control on Live sessions.[^6][^35][^27][^4]
- Live session resumption, context window compression, and other `BidiGenerateContentSetup` features.[^33][^31][^3][^2]
- Direct handling of Live server messages (`turn_complete`, `interrupted`, `generation_complete`, tool call cancellation) in your own event loop.[^28][^27][^33][^2]

ADK still gives you a lot for free—agent orchestration, stateful sessions, tool wiring, and a dev UI—but for a highly tuned, native‑audio real‑time voice agent, the raw `google-genai` Live surface is where the full set of Gemini Live controls live today.
<span style="display:none">[^100][^101][^102][^103][^104][^105][^106][^107][^108][^109][^110][^111][^112][^113][^114][^115][^116][^117][^118][^119][^120][^121][^122][^123][^124][^125][^126][^127][^128][^129][^130][^131][^132][^133][^134][^135][^136][^137][^138][^139][^140][^141][^142][^143][^144][^145][^146][^147][^148][^149][^150][^151][^152][^153][^154][^155][^156][^157][^158][^159][^160][^161][^162][^163][^164][^165][^166][^167][^168][^169][^170][^171][^172][^173][^174][^175][^176][^177][^178][^179][^180][^181][^182][^38][^39][^40][^41][^42][^43][^44][^45][^46][^47][^48][^49][^50][^51][^52][^53][^54][^55][^56][^58][^60][^61][^62][^63][^65][^66][^67][^68][^69][^70][^71][^72][^73][^74][^75][^76][^77][^78][^79][^80][^81][^82][^83][^84][^85][^86][^87][^88][^89][^90][^91][^92][^93][^94][^95][^96][^97][^98][^99]</span>

<div align="center">⁂</div>

[^1]: https://google.github.io/adk-docs/runtime/runconfig/

[^2]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-live

[^3]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/configure-gemini-capabilities?hl=es

[^4]: https://ai.google.dev/gemini-api/docs/live-guide?hl=es-419

[^5]: https://ai.google.dev/gemini-api/docs/live-api/capabilities

[^6]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/configure-gemini-capabilities?hl=es-419

[^7]: https://ai.google.dev/api/caching

[^8]: https://docs.cloud.google.com/go/docs/reference/cloud.google.com/go/ai/latest/generativelanguage/apiv1beta/generativelanguagepb

[^9]: https://google.github.io/adk-docs/api-reference/agentconfig/

[^10]: https://www.scribd.com/document/914747993/Google-Gen-AI-SDK

[^11]: https://ai.google.dev/gemini-api/docs/live-tools

[^12]: https://ai.google.dev/gemini-api/docs/live-api/tools?hl=es-419

[^13]: https://colab.research.google.com/github/google-gemini/cookbook/blob/main/quickstarts/Get_started_LiveAPI_tools.ipynb

[^14]: https://ai.google.dev/gemini-api/docs/live-tools?hl=pl

[^15]: https://google.github.io/adk-docs/tools-custom/function-tools/

[^16]: https://google.github.io/adk-docs/tools-custom/

[^17]: https://google.github.io/adk-docs/events/

[^18]: https://github.com/google/adk-python/issues/2215

[^19]: https://ai.google.dev/gemini-api/docs/live-api/tools?hl=hi

[^20]: https://github.com/googleapis/googleapis/blob/master/google/ai/generativelanguage/v1beta/content.proto

[^21]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling?hl=es

[^22]: https://github.com/google/adk-python/issues/4311

[^23]: https://newreleases.io/project/github/google/adk-python/release/v1.24.0

[^24]: https://github.com/google/adk-python/actions/runs/17495180010

[^25]: https://googleapis.github.io/python-genai/

[^26]: https://ai.google.dev/api/generate-content

[^27]: https://ai.google.dev/gemini-api/docs/live-api/capabilities?hl=es-419

[^28]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-live?hl=id

[^29]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/get-started-adk

[^30]: https://google.github.io/adk-docs/streaming/dev-guide/part1/

[^31]: https://ai.google.dev/gemini-api/docs/live-session.md.txt

[^32]: https://docs.livekit.io/reference/python/livekit/plugins/google/realtime/realtime_api.html

[^33]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-live?hl=fr

[^34]: https://github.com/googleapis/python-genai/issues/865

[^35]: https://agentfactory.panaversity.org/docs/Building-Realtime-Voice-Agents/gemini-live-api/affective-proactive-audio

[^36]: https://github.com/googleapis/python-genai/issues/876

[^37]: https://pkg.go.dev/cloud.google.com/go/ai/generativelanguage/apiv1alpha/generativelanguagepb

[^38]: https://arxiv.org/pdf/2406.01339.pdf

[^39]: https://arxiv.org/pdf/2209.10317.pdf

[^40]: https://www.jenrs.com/?download_id=3400\&smd_process_download=1

[^41]: https://arxiv.org/pdf/2205.15546.pdf

[^42]: https://arxiv.org/pdf/2204.05911.pdf

[^43]: http://arxiv.org/pdf/2410.02809.pdf

[^44]: https://arxiv.org/pdf/2201.12542.pdf

[^45]: http://arxiv.org/pdf/2411.04387.pdf

[^46]: https://github.com/google/adk-python

[^47]: https://codelabs.developers.google.com/deploy-manage-observe-adk-cloud-run?hl=es-419

[^48]: https://www.leoniemonigatti.com/blog/building-ai-agents-with-google-adk.html

[^49]: https://freshbrewed.science/2026/02/17/gcpadk.html

[^50]: https://developers.googleblog.com/en/supercharge-your-ai-agents-adk-integrations-ecosystem/

[^51]: https://github.com/livekit/agents/issues/2367

[^52]: https://github.com/google/adk-python/issues/4649

[^53]: https://arxiv.org/html/2312.05398v3

[^54]: https://arxiv.org/pdf/2402.16631.pdf

[^55]: https://arxiv.org/html/2504.04414v1

[^56]: https://arxiv.org/pdf/2411.01458.pdf

[^57]: http://arxiv.org/pdf/2501.04764.pdf

[^58]: http://arxiv.org/pdf/2502.15816.pdf

[^59]: https://aclanthology.org/2023.emnlp-demo.20.pdf

[^60]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/samples/googlegenaisdk-live-with-txt?hl=es-419

[^61]: https://github.com/googleapis/python-genai/issues/689

[^62]: https://googleapis.dev/python/generativelanguage/latest/generativelanguage_v1alpha/generative_service.html

[^63]: https://googleapis.github.io/js-genai/release_docs/classes/live.Live.html

[^64]: https://googleapis.dev/python/generativelanguage/latest/generativelanguage_v1alpha/types_.html

[^65]: https://colab.research.google.com/github/GoogleCloudPlatform/generative-ai/blob/main/gemini/multimodal-live-api/intro_live_api_native_audio.ipynb?hl=fr

[^66]: https://colab.research.google.com/github/GoogleCloudPlatform/generative-ai/blob/main/gemini/multimodal-live-api/intro_multimodal_live_api.ipynb

[^67]: https://github.com/googleapis/python-genai/issues/1367

[^68]: https://arxiv.org/html/2412.00446v1

[^69]: http://arxiv.org/pdf/2403.08312.pdf

[^70]: https://arxiv.org/pdf/1710.03439.pdf

[^71]: http://arxiv.org/pdf/2502.12826.pdf

[^72]: https://arxiv.org/html/2410.00884v1

[^73]: https://arxiv.org/pdf/2411.09289.pdf

[^74]: https://arxiv.org/pdf/2210.07311.pdf

[^75]: https://arxiv.org/abs/2410.14066

[^76]: https://github.com/googleapis/java-genai/issues/781

[^77]: https://colab.research.google.com/github/GoogleCloudPlatform/generative-ai/blob/main/gemini/multimodal-live-api/intro_multimodal_live_api_genai_sdk.ipynb?hl=zh-cn

[^78]: https://github.com/googleapis/python-genai/blob/main/google/genai/live.py

[^79]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/configure-gemini-capabilities

[^80]: https://github.com/google/adk-java/issues/281

[^81]: https://lobehub.com/skills/google-gemini-gemini-skills-gemini-live-api-dev

[^82]: https://tessl.io/registry/tessl/maven-com-google-genai--google-genai/1.28.0/docs/live-sessions.md

[^83]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/samples/googlegenaisdk-live-with-txt

[^84]: http://arxiv.org/pdf/2308.12276.pdf

[^85]: http://arxiv.org/pdf/2402.15391.pdf

[^86]: https://arxiv.org/html/2503.16586

[^87]: https://arxiv.org/html/2410.20643v2

[^88]: https://arxiv.org/html/2503.23574v1

[^89]: https://colab.research.google.com/github/GoogleCloudPlatform/generative-ai/blob/main/gemini/multimodal-live-api/intro_live_api_native_audio.ipynb?hl=de

[^90]: https://github.com/googleapis/python-genai/issues/1275

[^91]: https://getstream.io/blog/drive-thru-voice-ai/

[^92]: https://www.semanticscholar.org/paper/d67976e4cd3ddc541172455c854c2be76d15baae

[^93]: https://arxiv.org/abs/2410.04587

[^94]: https://arxiv.org/abs/2504.00914

[^95]: https://arxiv.org/abs/2409.00608

[^96]: https://arxiv.org/abs/2407.00121

[^97]: https://arxiv.org/abs/2507.10593

[^98]: https://arxiv.org/abs/2506.19500

[^99]: https://arxiv.org/abs/2502.00032

[^100]: https://ieeexplore.ieee.org/document/11340083/

[^101]: https://arxiv.org/abs/2508.15214

[^102]: https://arxiv.org/pdf/2409.00920.pdf

[^103]: https://arxiv.org/pdf/2109.01002.pdf

[^104]: https://arxiv.org/pdf/1812.04894.pdf

[^105]: http://arxiv.org/pdf/2208.06318.pdf

[^106]: https://arxiv.org/ftp/arxiv/papers/2208/2208.05317.pdf

[^107]: https://arxiv.org/pdf/2501.04963.pdf

[^108]: https://arxiv.org/pdf/2408.01810.pdf

[^109]: https://www.youtube.com/watch?v=nRpyp2m6mn8

[^110]: https://www.reddit.com/r/agentdevelopmentkit/comments/1kppx7g/function_tool_calling_with_google_adk/

[^111]: https://github.com/arjunprabhulal/adk-gemma3-function-calling

[^112]: https://codelabs.developers.google.com/onramp/instructions

[^113]: https://www.youtube.com/watch?v=oYuPW3wa3io

[^114]: https://cloud.google.com/blog/topics/developers-practitioners/tools-make-an-agent-from-zero-to-assistant-with-adk

[^115]: https://iamulya.one/posts/adk-runner-and-runtime-configuration/

[^116]: https://dev.to/pasmichal/how-to-pass-data-from-a-function-tool-to-state-in-adk-agent-development-kit-2p2n

[^117]: https://codelabs.developers.google.com/codelabs/cloud-run/tools-make-an-agent

[^118]: https://github.com/google/adk-python/issues/1101

[^119]: https://scholar.kyobobook.co.kr/article/detail/4010071639085

[^120]: https://arxiv.org/abs/2510.11695

[^121]: https://www.nature.com/articles/s43018-026-01126-1

[^122]: https://esskajournals.onlinelibrary.wiley.com/doi/10.1002/ksa.70315

[^123]: https://www.semanticscholar.org/paper/7aa3e38104392499dfa83789d73d54d8a207320a

[^124]: https://cinergie.unibo.it/article/view/23123

[^125]: https://www.spiedigitallibrary.org/conference-proceedings-of-spie/13101/3019104/A-modern-GUI-for-the-control-and-tuning-of-the/10.1117/12.3019104.full

[^126]: https://journals.scholarpublishing.org/index.php/AIVP/article/view/19976

[^127]: https://pubs.acs.org/doi/10.1021/acs.analchem.1c04556

[^128]: https://www.nature.com/articles/s41589-019-0381-8

[^129]: https://arxiv.org/pdf/1304.4860.pdf

[^130]: http://arxiv.org/pdf/2403.05530.pdf

[^131]: https://academic.oup.com/bioinformatics/article/39/Supplement_1/i504/7210443

[^132]: http://arxiv.org/pdf/2312.11805.pdf

[^133]: https://pmc.ncbi.nlm.nih.gov/articles/PMC6624979/

[^134]: https://pmc.ncbi.nlm.nih.gov/articles/PMC3715403/

[^135]: https://arxiv.org/pdf/2412.18708.pdf

[^136]: https://www.mdpi.com/1648-9144/60/9/1493

[^137]: https://github.com/livekit/agents/issues/3801

[^138]: https://github.com/googleapis/python-genai/issues/1894

[^139]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/Content

[^140]: https://github.com/googleapis/python-genai/issues/1739

[^141]: https://hexdocs.pm/gemini_ex/

[^142]: https://tessl.io/registry/tessl/npm-google--genai/1.30.0/files/docs/function-calling.md

[^143]: https://ai.google.dev/gemini-api/docs/live-tools?hl=vi

[^144]: https://pkg.go.dev/google.golang.org/genai

[^145]: https://aclanthology.org/2023.emnlp-main.53.pdf

[^146]: http://arxiv.org/pdf/2405.03162.pdf

[^147]: https://arxiv.org/html/2503.16788v1

[^148]: https://arxiv.org/pdf/2403.08295.pdf

[^149]: http://arxiv.org/pdf/2405.03671.pdf

[^150]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling

[^151]: https://pub.dev/documentation/gemini_box/latest/gemini_box/FunctionResponse-class.html

[^152]: https://github.com/mohan-ganesh/spring-boot-google-adk-firestore/blob/master/README.md

[^153]: https://github.com/google-gemini/genai-processors/actions/runs/21672821700

[^154]: https://googleapis.github.io/python-genai/genai.html

[^155]: https://hexdocs.pm/gemini_ex/Gemini.Types.FunctionResponse.html

[^156]: https://google.github.io/adk-docs/api-reference/python/google-adk.html

[^157]: https://docs.getbifrost.ai/api-reference/langchain-integration/generate-content-langchain--gemini-format

[^158]: https://www.ijsr.net/getabstract.php?paperid=SR25915100037

[^159]: https://arxiv.org/abs/2601.22569

[^160]: https://arxiv.org/abs/2508.10146

[^161]: https://ieeexplore.ieee.org/document/11241317/

[^162]: https://ieeexplore.ieee.org/document/11333875/

[^163]: https://www.semanticscholar.org/paper/fe9b54d5346e6e9720d96d3241df289f8bccd67f

[^164]: https://www.semanticscholar.org/paper/a892baf3b42b5462fc5dabd470d9bfdbfaeaae99

[^165]: https://www.semanticscholar.org/paper/8e9426a6ec1d3237dc59d2abef96445fe788f296

[^166]: https://bmcmededuc.biomedcentral.com/articles/10.1186/s12909-025-07258-9

[^167]: https://openaccess.cms-conferences.org/publications/book/978-1-964867-73-1/article/978-1-964867-73-1_13

[^168]: http://aip.vse.cz/doi/10.18267/j.aip.77.pdf

[^169]: https://arxiv.org/html/2406.17431v2

[^170]: http://eudl.eu/pdf/10.4108/ue.1.4.e1

[^171]: https://arxiv.org/pdf/1706.05042.pdf

[^172]: https://arxiv.org/pdf/2502.15270.pdf

[^173]: https://arxiv.org/pdf/2111.08217.pdf

[^174]: http://arxiv.org/pdf/1708.02380.pdf

[^175]: http://arxiv.org/pdf/1407.4923.pdf

[^176]: https://github.com/googleapis/python-genai/issues/2117

[^177]: https://www.kaggle.com/code/engmostafaali/fine-tuning-gpt

[^178]: https://www.kaggle.com/code/aravindhan0905/notebookf62b2cda15

[^179]: https://www.kaggle.com/code/danielantoniotucanes/notebookc6b28791c5

[^180]: https://www.kaggle.com/code/ashvantnarayany/notebook84a7b16e20

[^181]: https://github.com/google/adk-python/issues/2014

[^182]: https://codelabs.developers.google.com/adk-multimodal-tool-part-1

