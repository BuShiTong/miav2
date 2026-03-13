<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# In the Google Gemini Live API (WebSocket-based real-time streaming API), the native audio model on Vertex AI (gemini-live-2.5-flash-native-audio) has a known issue where the model continues generating audio after emitting a function call (tool call), instead of pausing and waiting for the function response. This causes duplicate or repeated speech.

On Google AI Studio, this is handled by the behavior: "NON_BLOCKING" / "BLOCKING" parameter on function definitions and scheduling: "SILENT" / "WHEN_IDLE" / "INTERRUPT" on function responses — but these parameters are not supported on Vertex AI.
What workarounds exist to prevent the Vertex AI native audio model from speaking during or after a function call? Specifically:
Has Google released any update in 2026 that adds scheduling/blocking support to Vertex AI?
Does disabling AutomaticActivityDetection and using manual ActivityStart/ActivityEnd signals help control model generation during tool calls?
Can sending a clientContent message with turnComplete: true immediately after receiving a toolCall interrupt the model?
Are there any other protocol-level or SDK-level workarounds that developers have successfully used?
Has the behavior of gemini-live-2.5-flash-native-audio on Vertex AI changed since the bug reports in December 2025?

Short answer: as of March 2026, Vertex AI’s Gemini Live native‑audio endpoint still does **not** honor the NON_BLOCKING + scheduling knobs the way the Google AI Studio (Gemini API) endpoint does, so you need client‑side workarounds (fire‑and‑forget tools, audio gating, careful turn management).[^1][^2]

Below I’ll go through each of your specific questions and then outline the patterns that are actually working in practice.

***

## 1. Did 2026 add real scheduling/blocking support on Vertex?

**What the docs say**

- The shared Vertex Generative AI schema now exposes `FunctionResponse.scheduling` with `SILENT`, `WHEN_IDLE`, and `INTERRUPT` enum values, and this page was updated in March 2026.[^1]
- The Vertex AI Python SDK and other official clients include a `FunctionResponseScheduling` type and related helpers, explicitly described as “only applicable to NON_BLOCKING function calls.”[^3][^4]
- The Gemini 2.5 Flash Live Native Audio model (`gemini-live-2.5-flash-native-audio`) is GA on Vertex, supports function calling, and its model page is also freshly updated (March 13, 2026).[^5]

**What actually happens on Vertex Live**

- A March 2026 field‑report thread focused specifically on **Vertex AI GA + Gemini Live native audio** found that `FunctionResponseScheduling.SILENT` is **silently stripped by the Vertex protobuf**, so the model never sees the scheduling hint and still narrates tool results.[^2]
- A LiveKit plugin issue notes they have to **drop both the `scheduling` and `id` fields when talking to Vertex**, because Vertex rejects or strips them, even though the same code works against the Gemini API.[^6]
- The js‑genai GitHub repo still lists “Live API Model fails to pause generation after Tool Call on Vertex AI” as an open bug, explicitly saying it occurs for `gemini-live-2.5-flash-native-audio` but not when using the Gemini API’s `gemini-2.5-flash-*` models.[^7][^8][^9]

**Conclusion:**
There *is* a shared scheduling enum and client types now, but for **Vertex Live with `gemini-live-2.5-flash-native-audio` the scheduling hints are not reliably applied**; in particular, `SILENT` is dropped and does not solve duplicate post‑tool speech.  There’s no public indication that 2026 introduced full NON_BLOCKING + scheduling parity for Vertex Live.[^6][^2][^1]

***

## 2. Does disabling AutomaticActivityDetection + manual ActivityStart/ActivityEnd help?

Vertex’s Live API lets you:

- Turn off automatic VAD with `RealtimeInputConfig.automatic_activity_detection.disabled = true`.
- Then you must send explicit `ActivityStart` and `ActivityEnd` messages to mark when the user is speaking.[^10][^11]

Several developers report that **moving VAD and turn segmentation to the client** greatly improves “ghosting”, missing responses, and some tool‑use flakiness on the *native audio* models:

- In one long thread, teams testing `gemini-2.5-flash-native-audio` say disabling built‑in VAD and using **manual activity windows** reduced silent failures and made tool calls more reliable for production workloads, and some even switched to client‑side buffering + batch sends for extra stability.[^12]

However:

- These reports are about **when** the model responds (stability, ghosting), not about **stopping it from narrating around function calls**.
- The model will still emit audio `modelTurn` parts during and after tool calls; manual VAD only affects how user input is grouped into turns.[^11][^10][^12]

**So:**
Manual `ActivityStart`/`ActivityEnd` is a good idea for stability, but by itself it **doesn’t prevent the native audio model from speaking during/after tool calls**; you still need client‑side gating or other patterns to suppress that audio.[^10][^11][^12]

***

## 3. Can `clientContent` with `turnComplete: true` after a `toolCall` interrupt the model?

From the official WebSockets reference:

- `ClientContent.turnComplete` tells the server “start generation now with the currently accumulated prompt”; on the *server* side, `turnComplete` in `ServerContent` signals that the model’s turn is done.[^13]

From a March 2026 field guide based on extensive Live testing:

- **Any `sendClientContent` with `turnComplete: true` while the model is speaking interrupts it**: the model stops mid‑sentence and starts a new response.[^2]

Implications:

- Yes, if you send a `clientContent` message immediately after receiving a `toolCall`, **you can forcibly cut off ongoing audio** and trigger a new turn.[^13][^2]
- However, this is a blunt tool:
    - It interrupts even if the speech was mid‑thought.[^2]
    - If you also include context/tool results in that `clientContent`, they will be treated as a new turn; you must ensure your playback stack immediately flushes any queued audio and doesn’t play the tail end of the interrupted turn.[^13][^2]
    - A community cookbook issue reports using a combined workaround that sends a `FunctionResponse` *as a Part* inside `clientContent` with `turnComplete: true`, but that’s slightly off the canonical “sendToolResponse” path and still depends on client‑side handling.[^14]

The same March 2026 guide explicitly warns that **“context injection is dangerous”**: sending `clientContent` with `turnComplete: true` mid‑turn interrupts speech, so they recommend buffering such messages and flushing them only after the server’s `turnComplete` *and* after the last audio chunk has finished playback.[^2]

**So:**
You *can* use `clientContent` with `turnComplete: true` as a hard interrupt, but it’s not a clean, tool‑specific pause mechanism; it requires careful audio‑queue management and is easy to misuse.

***

## 4. Other protocol‑ / SDK‑level workarounds that actually help

### 4.1 “Fire‑and‑forget” tools + no `sendToolResponse`

A March 2026 pattern write‑up for **Vertex AI GA + Gemini Live native audio** recommends treating tools as **one‑way side effects**:[^2]

- **Do not send `sendToolResponse` at all.** Execute the function on your backend and do *not* inform the model via a tool response, since scheduling hints like `SILENT` are stripped on Vertex anyway.[^2]
- For state the model needs (scores, round numbers, etc.), buffer that information and later inject a textual summary as `clientContent` *only after* the model has fully finished its spoken turn (server `turnComplete` + playback finished).[^2]

This avoids the “tool result” moment entirely from the model’s perspective, which sidesteps the native audio model’s habit of narrating tool outcomes.

### 4.2 Four‑layer defense including client‑side audio gating

The same guide reports that simply configuring tools as “silent” in instructions was not enough. Their measured fix was a **four‑layer strategy**:[^2]

1. Add phrases like **“SILENT EXECUTION.”** to every tool’s description.
2. System instructions (SI): “Say nothing after tool calls. Call the tool and stop.”
3. Fire‑and‑forget: never send tool responses back to the model.
4. **Client‑side audio gating**: as soon as you detect a `toolCall` event, stop playing model audio and drop all audio chunks until the model’s turn is marked complete.[^2]

They report:

- With only layers 1–3, the model *still* narrated tool calls in ~67% of cases.
- Adding audio gating (layer 4) brought narration to 0% across 10 consecutive end‑to‑end runs.[^2]

This aligns with other community implementations (for example, Twilio + Gemini Live integrations) where:

- On `event.interrupted` or `event.turn_complete`, they **flush the downstream audio stream** and set flags that cause all further `content` events to be suppressed until it’s safe to resume.[^15]

In your own WebSocket stack, this typically means:

- Maintain a state flag like `suppress_model_audio`.
- When you see a `toolCall`, set `suppress_model_audio = true`, flush queued audio to your output device, and don’t enqueue further audio until you see a `serverContent.turnComplete` (and optionally after your TTS/output pipeline has actually gone silent).[^15][^2]


### 4.3 Manual VAD + batched or semi‑batched turns

Beyond stability, some teams have adopted **client‑side VAD with batched sends**:[^12]

- Disable automatic VAD in `RealtimeInputConfig` and handle voice activity, buffering, and segmentation locally.[^11][^10][^12]
- Instead of continuously streaming, send a buffered utterance as one logical turn (or a small number of coarse chunks), so tool calls happen at well‑defined boundaries, not mid‑stream.[^12]

One production‑oriented workaround specifically for native audio:

- Local VAD detects silence → cut the recording.
- Upload that buffer as a single Live API input turn to `gemini-2.5-flash-native-audio`; this “forces the model to treat the input as a complete thought,” which significantly improves tool‑calling reliability at the cost of some latency.[^12]

This pattern doesn’t directly stop narration after tools, but it makes the overall behavior more predictable and easier to gate.

### 4.4 Offloading tool orchestration to a text model

Some developers avoid heavy tool calling on the native‑audio model entirely:

- A community post describes instead using the native audio model for **speech + transcription**, then passing its transcript to a cheaper text model (e.g., `gemini-2.5-flash-lite`) to perform JSON extraction, tool selection, or other structured logic.[^16]

In this setup:

- The native audio model mostly “talks and listens”; it does minimal or no tool calling.
- All complex tools run in a separate text pipeline where async behavior and scheduling are much easier to control.[^16]


### 4.5 Using half‑cascade models when possible

Several teams comparing models have found:

- Native‑audio models (`gemini-2.5-flash-native-audio*`) offer the most natural speech but still have **stability and tool‑use issues**.[^17][^12]
- The **half‑cascaded** Live models (`gemini-live-2.5-flash-preview` and older `gemini-2.0-flash-live-001`) tend to be more reliable with tool use, at the cost of some latency and expressiveness, and some developers prefer them in production until native audio stabilizes.[^17][^12]

If end‑to‑end latency is not absolutely critical, migrating your Vertex agent to a half‑cascade Live model for tool‑heavy flows is a pragmatic workaround.

***

## 5. Has `gemini-live-2.5-flash-native-audio` behavior on Vertex changed since Dec 2025?

Evidence of changes:

- Google’s December 2025 blog post on the updated audio models claims Gemini 2.5 Flash Native Audio has **“sharper function calling and better instruction following,”** improving conversational smoothness.[^18]
- The Vertex model reference shows `gemini-live-2.5-flash-native-audio` as GA with function calling supported, and the page was updated March 13, 2026, suggesting ongoing evolution.[^19][^5]

Evidence that the **tool‑call speech behavior remains problematic**:

- A GitHub issue in `googleapis/js-genai` (“Live API Model fails to pause generation after Tool Call on Vertex AI”) explicitly reports that the Vertex AI native audio model keeps generating after a tool call, while the same code against the Gemini API behaves correctly. This issue is still tracked as open.[^8][^9][^7]
- A LiveKit agents issue from January 2026 titled **“Gemini Live (Vertex AI, native audio) speaks twice after function calls”** describes duplicate responses when calling tools with `gemini-live-2.5-flash-native-audio`.[^20][^21]
- The March 2026 “Hard‑Won Patterns” thread, based on dozens of test runs against Vertex AI GA, states that **every tool response still triggers narration** and that `FunctionResponseScheduling.SILENT` is stripped by Vertex, forcing them into the four‑layer workaround described above.[^2]

Putting that together, it appears:

- Tool triggering reliability and general instruction‑following have improved since the earliest preview models.[^5][^18][^12]
- **But the specific “continues speaking / narrates tool calls / duplicate speech” behavior on Vertex Live with `gemini-live-2.5-flash-native-audio` is still present in early 2026**, and the official scheduling/blocking knobs are not yet wired through in a way that fully fixes it.[^21][^7][^20][^2]

***

## 6. Direct answers to your specific questions

1. **“Has Google released any update in 2026 that adds scheduling/blocking support to Vertex AI?”**
    - The shared Vertex schema and SDKs now expose `FunctionResponse.scheduling` and a `FunctionResponseScheduling` type, but **Vertex Live currently strips or ignores scheduling for native‑audio tool responses (notably `SILENT`)**, so you do *not* get the same behavior as on the Gemini API.[^3][^1][^6][^2]
    - There is no public changelog or doc that says “Vertex Live now supports NON_BLOCKING + scheduling exactly like Gemini API,” and open issues still report the pause‑on‑tool‑call bug for Vertex.[^9][^7][^8]
2. **“Does disabling AutomaticActivityDetection and using manual ActivityStart/ActivityEnd help control model generation during tool calls?”**
    - It helps with turn segmentation, stability, and some ghosting issues, and several teams recommend it for production.[^10][^11][^12]
    - It **does not by itself stop the model from speaking during or after tool calls**; the model still streams audio `modelTurn` parts, and you need client‑side suppression to avoid duplicate or undesired speech.[^11][^10][^12]
3. **“Can sending a clientContent message with turnComplete: true immediately after receiving a toolCall interrupt the model?”**
    - Yes. The WebSocket spec and community testing show that any `sendClientContent` with `turnComplete: true` while the model is speaking **interrupts the current turn and starts a new one**.[^13][^2]
    - However, it’s a blunt interrupt: it will cut speech mid‑sentence and requires you to flush the audio queue on your side; the same March 2026 guide warns against using this for mid‑turn context injection and recommends buffering context instead.[^2]
4. **“Are there any other protocol‑ or SDK‑level workarounds that developers have successfully used?”**
Yes, the main ones are:
    - **Fire‑and‑forget tools** (no `sendToolResponse`), with state re‑injected as buffered `clientContent` after turns.[^2]
    - **Client‑side audio gating**: stop and drop audio chunks after tool calls until `serverContent.turnComplete` + playback completion, which eliminated narration in tests.[^15][^2]
    - **Manual VAD + batched/single‑turn audio** for more predictable behavior.[^10][^11][^12]
    - **Offloading tool orchestration to a text model** using the native‑audio model only for speech and transcription.[^16]
    - **Using half‑cascade Live models** (`gemini-live-2.5-flash-preview`, etc.) for tool‑heavy agents where added latency is acceptable.[^17][^12]
5. **“Has the behavior of gemini-live-2.5-flash-native-audio on Vertex AI changed since the bug reports in December 2025?”**
    - The model has seen overall improvements in function‑calling quality and instruction‑following, and is now GA on Vertex AI.[^18][^19][^5]
    - However, community reports from January–March 2026 still describe **continued speech and duplicate narration around tool calls on Vertex**, and a March 2026 field guide confirms that scheduling hints like `SILENT` are not honored, requiring multi‑layer workarounds.[^7][^20][^21][^2]

If you’d like, I can sketch a concrete WebSocket handling loop (in Node or Python) that implements the “fire‑and‑forget + audio gating” pattern for `gemini-live-2.5-flash-native-audio` on Vertex.
<span style="display:none">[^100][^101][^102][^103][^104][^105][^106][^107][^108][^109][^110][^111][^112][^113][^114][^115][^116][^117][^118][^119][^120][^121][^122][^123][^124][^125][^126][^127][^128][^129][^130][^131][^132][^133][^134][^135][^136][^137][^138][^139][^140][^141][^142][^143][^144][^145][^146][^147][^148][^149][^150][^151][^152][^153][^154][^155][^156][^157][^158][^159][^160][^161][^162][^163][^164][^22][^23][^24][^25][^26][^27][^28][^29][^30][^31][^32][^33][^34][^35][^36][^37][^38][^39][^40][^41][^42][^43][^44][^45][^46][^47][^48][^49][^50][^51][^52][^53][^54][^55][^56][^57][^58][^59][^60][^61][^62][^63][^64][^65][^66][^67][^68][^69][^70][^71][^72][^73][^74][^75][^76][^77][^78][^79][^80][^81][^82][^83][^84][^85][^86][^87][^88][^89][^90][^91][^92][^93][^94][^95][^96][^97][^98][^99]</span>

<div align="center">⁂</div>

[^1]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1beta1/Content

[^2]: https://discuss.ai.google.dev/t/hard-won-patterns-for-building-voice-apps-with-gemini-live-march-2026/128155

[^3]: https://docs.cloud.google.com/python/docs/reference/vertexai/latest/vertexai._genai.types.FunctionResponseScheduling

[^4]: https://docs.cloud.google.com/python/docs/reference/vertexai/latest

[^5]: https://cloud.google.com/blog/topics/developers-practitioners/how-to-use-gemini-live-api-native-audio-in-vertex-ai

[^6]: https://github.com/livekit/agents/issues/3784

[^7]: https://github.com/googleapis/js-genai/issues/1210

[^8]: https://github.com/googleapis/js-genai/issues

[^9]: https://github.com/googleapis/js-genai/labels/api: livestream

[^10]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-live

[^11]: https://ai.google.dev/gemini-api/docs/live-api/capabilities

[^12]: https://discuss.ai.google.dev/t/inconsistent-response-behavior-in-gemini-2-5-flash-native-audio-preview-09-2025-voicebot/110825

[^13]: https://ai.google.dev/api/live

[^14]: https://github.com/google-gemini/cookbook/issues/906

[^15]: https://discuss.ai.google.dev/t/handling-user-interruptions-with-gemini-live-2-5-flash-vertex-ai-model/94924

[^16]: https://www.reddit.com/r/Bard/comments/1roe1co/function_calling_on/

[^17]: https://github.com/livekit/agents/issues/2356

[^18]: https://blog.google/products-and-platforms/products/gemini/gemini-audio-model-updates/

[^19]: https://cloud.google.com/blog/products/ai-machine-learning/gemini-live-api-available-on-vertex-ai

[^20]: https://github.com/livekit/agents/issues/4554

[^21]: https://github.com/livekit/agents/labels/bug

[^22]: http://arxiv.org/pdf/2403.05530.pdf

[^23]: https://arxiv.org/pdf/2312.15821.pdf

[^24]: http://arxiv.org/pdf/2409.10999.pdf

[^25]: http://arxiv.org/pdf/2410.00767.pdf

[^26]: https://arxiv.org/pdf/2408.02622.pdf

[^27]: http://arxiv.org/pdf/2408.16725.pdf

[^28]: https://arxiv.org/abs/2102.01192

[^29]: https://arxiv.org/html/2412.16429v2

[^30]: https://discuss.ai.google.dev/t/scheduling-silent-in-non-blocking-function-response-not-preventing-duplicate-audio-generation/114361

[^31]: https://github.com/googleapis/python-genai/issues/1894

[^32]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api

[^33]: https://github.com/googleapis/python-genai/issues/2117

[^34]: https://colab.research.google.com/github/google-gemini/cookbook/blob/main/quickstarts/Get_started_LiveAPI_tools.ipynb

[^35]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api

[^36]: https://discuss.ai.google.dev/t/significant-delay-with-gemini-live-2-5-flash-native-audio/122650

[^37]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api?hl=es

[^38]: https://ai.google.dev/gemini-api/docs/live-tools?hl=es-419

[^39]: https://zenodo.org/record/8135716/files/2023_IEEECLOUD_IRIS_Interference_and_Resource_Aware_Predictive_Orchestration_for_ML_Inference_Serving.pdf

[^40]: https://arxiv.org/pdf/2407.14572.pdf

[^41]: https://arxiv.org/pdf/2403.08295.pdf

[^42]: https://arxiv.org/pdf/2412.07017.pdf

[^43]: https://arxiv.org/html/2504.03651v1

[^44]: https://arxiv.org/pdf/2308.02896.pdf

[^45]: https://arxiv.org/pdf/2412.18695.pdf

[^46]: https://github.com/livekit/agents/issues/2367

[^47]: https://www.reddit.com/r/Bard/comments/1nua36t/can_i_configure_unsafe_prompt_blocking_blocklist/

[^48]: https://forum.langchain.com/t/google-gemini-and-vertex-ai-doesnt-run-in-playground/1468

[^49]: https://hexdocs.pm/gemini_ex/changelog.html

[^50]: https://google.github.io/adk-docs/streaming/dev-guide/part1/

[^51]: https://github.com/livekit/agents/issues/3801

[^52]: https://firebase.google.com/docs/ai-logic/live-api?hl=es-419

[^53]: https://github.com/livekit/agents/issues/3762

[^54]: https://arxiv.org/pdf/2412.11272.pdf

[^55]: https://arxiv.org/pdf/2503.01174.pdf

[^56]: https://arxiv.org/html/2410.00037v2

[^57]: https://arxiv.org/pdf/2403.03100.pdf

[^58]: http://arxiv.org/pdf/2411.04387.pdf

[^59]: https://arxiv.org/html/2311.18188

[^60]: https://discuss.ai.google.dev/t/google-live-api/123208

[^61]: https://ai.google.dev/gemini-api/docs/live-api/tools

[^62]: https://github.com/google-gemini/live-api-web-console/issues/139

[^63]: https://github.com/googleapis/python-genai/issues/1739

[^64]: https://docs.livekit.io/reference/python/livekit/plugins/google/realtime/realtime_api.html

[^65]: https://github.com/zavora-ai/adk-rust

[^66]: https://colab.research.google.com/github/GoogleCloudPlatform/generative-ai/blob/main/gemini/multimodal-live-api/intro_multimodal_live_api.ipynb

[^67]: http://arxiv.org/pdf/2203.16697.pdf

[^68]: http://arxiv.org/pdf/2401.07053.pdf

[^69]: http://arxiv.org/pdf/2310.17318.pdf

[^70]: http://arxiv.org/pdf/2208.06318.pdf

[^71]: https://arxiv.org/pdf/2306.06624.pdf

[^72]: https://arxiv.org/pdf/2403.14940.pdf

[^73]: https://arxiv.org/pdf/2204.08348.pdf

[^74]: https://arxiv.org/pdf/2503.10306.pdf

[^75]: https://discuss.ai.google.dev/t/turncomplete-flag-set-to-false-in-clientcontentmessage-of-multimodal-live-api-prevents-processing-of-subsequent-realtimeinputmessage/62949

[^76]: https://github.com/google-gemini/deprecated-generative-ai-python/issues/682

[^77]: https://stackoverflow.com/questions/79851378/python-gemini-live-api-connectionclosederror-when-trying-to-load-previous-conver

[^78]: https://raw.githubusercontent.com/Fraser-Greenlee/my-huggingface-datasets/master/data/python-lines/test.jsonl

[^79]: https://pub.dev/documentation/gemini_live/latest/

[^80]: https://hexdocs.pm/gemini_ex/live_api.html

[^81]: https://pkg.go.dev/cloud.google.com/go/ai/generativelanguage/apiv1alpha/generativelanguagepb

[^82]: https://docs.prefect.io/llms-full.txt

[^83]: https://stackoverflow.com/questions/79627663/how-to-ensure-the-model-always-uses-the-latest-user-provided-context-after-a-seq

[^84]: https://reference-server.pipecat.ai/en/latest/_modules/pipecat/services/google/gemini_live/llm.html

[^85]: https://docs.cloud.google.com/go/docs/reference/cloud.google.com/go/ai/latest/generativelanguage/apiv1beta/generativelanguagepb

[^86]: https://journals.lww.com/10.1097/DBP.0000000000001431

[^87]: https://linkinghub.elsevier.com/retrieve/pii/S0140673617307602

[^88]: https://www.semanticscholar.org/paper/cb1bd22f8a4d331f9e1ade18b95a8ff38abc08b7

[^89]: https://www.frontiersin.org/articles/10.3389/fneur.2021.685721/full

[^90]: https://journals.lww.com/01273116-201409000-00008

[^91]: https://academic.oup.com/melus/article-lookup/doi/10.2307/467931

[^92]: https://link.springer.com/10.1007/s10212-022-00597-x

[^93]: http://www.tandfonline.com/doi/abs/10.1080/13528160903552865

[^94]: https://onlinelibrary.wiley.com/doi/10.1111/1742-6723.13912

[^95]: https://www.acpjournals.org/doi/10.7326/M18-1138

[^96]: https://arxiv.org/pdf/2312.11444.pdf

[^97]: http://arxiv.org/pdf/2411.09224.pdf

[^98]: http://arxiv.org/pdf/2410.04587.pdf

[^99]: https://arxiv.org/html/2503.16788v1

[^100]: http://arxiv.org/pdf/2407.17915.pdf

[^101]: https://dl.acm.org/doi/pdf/10.1145/3597503.3639180

[^102]: https://deepmind.google/models/gemini-audio/

[^103]: https://github.com/google/adk-docs/issues/335

[^104]: https://ai.google.dev/gemini-api/docs/live-api/capabilities?hl=es-419

[^105]: https://firebase.google.com/docs/ai-logic/live-api

[^106]: https://cloudprice.net/models/gemini-live-2.5-flash-preview-native-audio-09-2025

[^107]: https://www.reddit.com/r/GeminiAI/comments/1kwiygy/the_new_gemini_live/

[^108]: https://www.youtube.com/watch?v=jWD5ki9058A

[^109]: http://arxiv.org/pdf/2407.13945.pdf

[^110]: http://arxiv.org/pdf/2310.02226.pdf

[^111]: https://arxiv.org/pdf/2305.15334.pdf

[^112]: http://arxiv.org/pdf/2411.15399.pdf

[^113]: https://dl.acm.org/doi/pdf/10.1145/3622806

[^114]: https://arxiv.org/pdf/2409.15523.pdf

[^115]: https://arxiv.org/pdf/2310.04685.pdf

[^116]: http://arxiv.org/pdf/2503.20527.pdf

[^117]: https://github.com/googleapis/js-genai/labels/priority: p2

[^118]: https://github.com/googleapis/python-genai/issues/1725

[^119]: https://github.com/googleapis/js-genai/issues/707

[^120]: https://discuss.ai.google.dev/t/issue-with-gemini-live-2-5-flash-model/100900

[^121]: https://github.com/googleapis/python-genai/labels/type: bug

[^122]: https://github.com/googleapis/js-genai/issues/1209

[^123]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/audio-understanding

[^124]: https://github.com/googleapis/python-genai/issues/1275

[^125]: https://arxiv.org/html/2407.10973

[^126]: https://arxiv.org/pdf/2503.22673.pdf

[^127]: http://arxiv.org/pdf/2501.07596.pdf

[^128]: https://arxiv.org/pdf/1712.06139.pdf

[^129]: http://arxiv.org/pdf/2407.08065.pdf

[^130]: https://arxiv.org/pdf/2109.01002.pdf

[^131]: http://arxiv.org/pdf/2302.04732.pdf

[^132]: https://arxiv.org/abs/2409.19326

[^133]: https://googleapis.github.io/python-genai/

[^134]: https://ai.google.dev/api/caching

[^135]: https://scouts.yutori.com/71b5cf62-d9df-415a-bc8d-636e2332772f

[^136]: https://github.com/firebase/firebase-android-sdk/issues/7687

[^137]: https://fisherdaddy.com/posts/google-io-2025-collection-first-day/

[^138]: https://hexdocs.pm/gemini_ex/

[^139]: https://ai.google.dev/gemini-api/docs/live-tools?hl=fr

[^140]: https://www.plainconcepts.com/google-io-2025-recap/

[^141]: https://www.scribd.com/document/914747993/Google-Gen-AI-SDK

[^142]: https://beei.org/index.php/EEI/article/view/7627

[^143]: https://link.aps.org/doi/10.1103/PhysRevLett.131.061803

[^144]: https://ieeexplore.ieee.org/document/11329976/

[^145]: https://link.aps.org/doi/10.1103/PhysRevD.102.032006

[^146]: https://journals.lww.com/10.1097/AOG.0000000000004746

[^147]: https://ieeexplore.ieee.org/document/10885501/

[^148]: https://link.aps.org/doi/10.1103/PhysRevD.108.012012

[^149]: https://link.springer.com/10.1007/JHEP06(2023)200

[^150]: https://www.scirp.org/journal/paperinformation?paperid=543

[^151]: https://www.semanticscholar.org/paper/7eb867d588f91bd59b8d8247072645e3c0761f39

[^152]: https://arxiv.org/pdf/2202.07848.pdf

[^153]: https://arxiv.org/pdf/2407.04845.pdf

[^154]: http://arxiv.org/pdf/2409.18444.pdf

[^155]: https://arxiv.org/pdf/2109.13492.pdf

[^156]: https://arxiv.org/html/2503.16029

[^157]: https://arxiv.org/pdf/2209.01709.pdf

[^158]: http://arxiv.org/pdf/2405.17438.pdf

[^159]: https://googleapis.github.io/python-genai/genai.html

[^160]: https://docs.livekit.io/reference/python/livekit/plugins/google/realtime/index.html

[^161]: https://ai.google.dev/gemini-api/docs/live-tools?hl=de

[^162]: https://gemini.cadn.net.cn/gemini-api/docs/live-tools.html

[^163]: https://pkg.go.dev/google.golang.org/genai

[^164]: https://pkg.go.dev/github.com/plar/genai

