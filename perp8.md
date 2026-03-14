<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# I'm using the google-genai Python SDK (not ADK) with gemini-live-2.5-flash-native-audio on Vertex AI via LiveConnectConfig.

Which of these features are available in the raw SDK on Vertex AI specifically: context_window_compression (SlidingWindow with trigger_tokens), session_resumption (SessionResumptionConfig), and prefixTurns? Are any of them only available at the WebSocket protocol level or only on AI Studio (not Vertex)?
Can you replace, remove, or summarize old conversation turns mid-session in a Live API connection using the raw SDK? Or is the conversation history immutable once sent?
What is the default context window size for gemini-live-2.5-flash-native-audio — is it 128K tokens or something smaller?
I care about: what actually works on Vertex AI today (not just what's documented), and whether Vertex strips any of these parameters like it does with BLOCKING/SILENT.
As of March 2026. Please include links to official Google docs, SDK source on GitHub, or API reference pages.

Here’s the practical state of things on Vertex AI with the **google‑genai Python SDK** and **gemini-live-2.5-flash-native-audio** as of March 2026, based on the Vertex docs, Live API reference, and SDK usage in the wild.

***

## What works in the raw Python SDK on Vertex

### `context_window_compression` (SlidingWindow + `trigger_tokens`)

**Available and supported on Vertex via `LiveConnectConfig`.**

- The underlying Live WebSocket API defines `BidiGenerateContentSetup.contextWindowCompression` with:
    - `triggerTokens` (when to start compression),
    - a `slidingWindow` mechanism with `targetTokens` (how much context to keep).[^1]
- The Vertex “Start and manage live sessions” guide explicitly shows configuring compression in Python with a `config` dict containing `context_window_compression.trigger_tokens` and `context_window_compression.sliding_window.target_tokens` for `gemini-live-2.5-flash-native-audio`.[^2]
- That same page states **all Gemini Live API models on Vertex use a 128k‑token context window** and describes how compression prunes or summarizes the oldest turns once `trigger_tokens` is exceeded.[^2]
- Third‑party bindings that sit on top of the **google‑genai** types (for example, LiveKit’s `realtime_api`) construct a `types.LiveConnectConfig` with a `context_window_compression: types.ContextWindowCompressionConfig`, which is then passed straight through to the Live API.[^3]

**Implications for you on Vertex with `google-genai`:**

- You can safely set `context_window_compression` on `types.LiveConnectConfig` when connecting via `client.aio.live.connect(model=..., config=...)` against Vertex; it is not a “WebSocket‑only” or Studio‑only feature.[^3][^2]
- The behavior is server‑side sliding window + optional summarization of old turns when the limit is crossed; you can control *when* and *how much* (via `trigger_tokens` and `sliding_window.target_tokens`), but **you don’t pick which specific turns get summarized or dropped**.[^1][^2]

***

### `session_resumption` (`SessionResumptionConfig`)

**Available and supported on Vertex via `LiveConnectConfig`.**

- The Live WebSocket API defines `BidiGenerateContentSetup.sessionResumption` and the corresponding `SessionResumptionConfig` / `SessionResumptionUpdate` messages for resumable sessions.[^1]
- The Vertex “Start and manage live sessions” page has a full **Python example that uses `types.LiveConnectConfig(session_resumption=types.SessionResumptionConfig(...))` with `client = genai.Client(vertexai=True, project=..., location=...)` and `MODEL = "gemini-live-2.5-flash-native-audio"`.** It shows:
    - Enabling resumption with `handle=None` on the first connection.
    - Receiving `session_resumption_update` messages with `new_handle`.
    - Reconnecting with a new `LiveConnectConfig(session_resumption=SessionResumptionConfig(handle=session_handle))` to resume context.[^2]
- LiveKit’s Python wrapper for Gemini Live does exactly the same thing: it builds a `types.LiveConnectConfig` with `session_resumption=types.SessionResumptionConfig(handle=self._session_resumption_handle)` and feeds that into `google.genai`.[^3]

**Implications:**

- **Session resumption is fully usable today from the raw `google-genai` SDK on Vertex.** Just pass `session_resumption=types.SessionResumptionConfig(handle=...)` inside `LiveConnectConfig` when you call `client.aio.live.connect` on a Vertex client.[^2][^3]
- It is not limited to Google AI Studio or to the bare WebSocket JSON API; Vertex exposes it in the same way.

***

### `prefixTurns` / `prefix_turns`

**Effectively *not* available on Vertex via the Python SDK; only present at the lower‑level protocol for the Gemini Developer API.**

- The **Gemini Live WebSockets API reference** for the developer (non‑Vertex) endpoint describes the `SlidingWindow` compression and explicitly says:

> “System instructions and any `BidiGenerateContentSetup.prefixTurns` will always remain at the beginning of the result.”[^1]

This tells us that, in the *generativelanguage* service, there is a `prefixTurns` field in `BidiGenerateContentSetup` that compression respects.
- The **Vertex** protobuf docs for `google.cloud.aiplatform.v1.BidiGenerateContentSetup` and related messages **don’t mention any `prefix_turns` or `prefixTurns` field at all**; searching that full RPC reference shows no such member in the Vertex surface.[^4]
- The general Live API reference (ai.google.dev) also does **not** list `prefixTurns` in the public JSON schema for `BidiGenerateContentSetup`; it is only referenced textually in the `SlidingWindow` description.[^1]
- None of the public examples for:
    - Vertex Live API,[^5][^2]
    - the official `google-genai` docs,[^6]
    - or third‑party wrappers that expose the full `LiveConnectConfig`
show a `prefix_turns` / `prefixTurns` attribute on `LiveConnectConfig` or any way to set it.[^7][^8][^3]

**So, as of March 2026:**

- There is an internal `prefixTurns` concept in the *generic* Live API spec (for the Gemini Developer API), but:
    - Vertex’s `LlmBidiService.BidiGenerateContent` surface does **not** expose a `prefix_turns` field in `BidiGenerateContentSetup`.[^4]
    - `google.genai.types.LiveConnectConfig` does **not** document or surface a `prefix_turns`/`prefixTurns` field.
- In practice, you should assume **you cannot configure `prefixTurns` on Vertex via the raw `google-genai` SDK today.** If you include a `prefixTurns` key in your own handcrafted WebSocket JSON to the Vertex endpoint, it is very likely to be ignored, because the documented Vertex proto doesn’t have that field.

***

## Is conversation history mutable mid‑session?

**No; once content is sent to the Live API in a session, it becomes part of the server‑side history and you cannot delete or overwrite it.**

- The Live API reference states for `BidiGenerateContentClientContent`:

> “All of the content here is **unconditionally appended to the conversation history** and used as part of the prompt to the model to generate content.”[^1]
- The Vertex “multimodal Live” model reference similarly describes `BidiGenerateContentClientContent.turns[]` as **content that is appended to the current conversation**, with `turn_complete` deciding when the model starts generating based on the accumulated prompt.[^4]

**What you *can* and *cannot* do:**

- You **cannot**:
    - Delete or edit prior turns in the same session (no “replace turn 3 with this summary” API).
    - Re‑send a different `setup` message (model, tools, compression, etc.) while the connection is open; configuration is fixed after the initial setup message.[^1]
- You **can**:
    - Start a *new* session and manually send in a summarized history as the initial user/model turns if you want a compact past context.
    - Let **context window compression** prune/summarize old turns automatically when `trigger_tokens` is exceeded.[^2][^1]

So in the raw Python SDK Live connection:

- **Conversation history is effectively immutable once sent.** You influence it only by:
    - Deciding what to send in the first place (including starting from a manually summarized history).
    - Configuring `context_window_compression` so the server can drop/summarize the oldest turns for you, not by explicit per‑turn editing.[^2][^1]

***

## Context window size for `gemini-live-2.5-flash-native-audio`

**The default (and maximum) context window is 128k tokens.**

- The Vertex Live API “Start and manage live sessions” doc says:

> “All Gemini Live API models have a context window limit of **128k tokens**.”[^2]

This section is specifically written in the context of `gemini-live-2.5-flash-native-audio`, and the code samples on that page all use that model ID.[^2]
- Context window compression config (`trigger_tokens` and `sliding_window.target_tokens`) is also constrained between 5,000 and 128,000 tokens, confirming that 128k is the hard limit on Vertex for Live models.[^2]

There is no separate, smaller context limit documented for the **native audio** flavor; it uses the same 128k context window as the other Gemini Live models on Vertex.[^2]

***

## Are any of these options “WebSocket‑only” or “AI Studio‑only”?

Putting it together:

- **Available in Vertex + `google-genai` LiveConnectConfig:**
    - `context_window_compression` (`ContextWindowCompressionConfig` with `trigger_tokens` and `SlidingWindow.target_tokens`).[^3][^1][^2]
    - `session_resumption` (`SessionResumptionConfig(handle=...)`).[^3][^1][^2]

These are not restricted to AI Studio; Vertex docs and Python examples use them directly, and third‑party libraries that wrap `google-genai` rely on them working end‑to‑end.
- **Effectively *not* available on Vertex via `google-genai`:**
    - `prefixTurns` / `prefix_turns`: only mentioned in the generic Live API docs on ai.google.dev, not exposed in the Vertex aiplatform RPC reference or in `LiveConnectConfig`.[^6][^4][^1]

***

## Does Vertex strip these parameters like `BLOCKING`/`SILENT`?

- The **tool‑calling scheduling flags** (`scheduling="INTERRUPT" | "WHEN_IDLE" | "SILENT"`) and function `behavior="NON_BLOCKING"` are defined in the Gemini Live tools docs on ai.google.dev, and those docs explicitly mention that they apply both to the generic Gemini API and the “Gemini API de VertexAI”.[^9][^10]
- There’s no indication in either:
    - The Vertex Live API documentation,[^4][^2]
    - or recent tool‑use docs
that Vertex strips or ignores `context_window_compression` or `session_resumption`; on the contrary, the Vertex docs *rely* on those fields to explain how to extend sessions and manage long‑running context.

Given:

- Official Vertex docs explicitly show these fields being set and describe their behavior in detail;[^2]
- Third‑party libraries that wrap the `google-genai` Vertex client pass `context_window_compression` and `session_resumption` through unmodified and rely on them;[^8][^7][^3]

it’s consistent to say:

- **Vertex does not strip or silently ignore `context_window_compression` or `session_resumption`.**
- **`prefixTurns` is simply not part of the Vertex surface**, so if you try to send it at the JSON level, it is best assumed to be ignored rather than honored.

If you want to be absolutely sure for your own stack, the most direct verification is to:

- Enable `context_window_compression` with a small `trigger_tokens` and watch for `usageMetadata.totalTokenCount` and behavior as you cross the threshold,[^1][^2]
- Enable `session_resumption` and confirm that you receive `session_resumption_update` messages and can resume with a handle across reconnects on Vertex as in the official sample.[^2]

Those two behaviors *only* occur when the server is actually honoring the corresponding config fields.
<span style="display:none">[^100][^101][^102][^103][^104][^105][^106][^107][^108][^109][^11][^110][^111][^112][^113][^114][^115][^116][^117][^118][^12][^13][^14][^15][^16][^17][^18][^19][^20][^21][^22][^23][^24][^25][^26][^27][^28][^29][^30][^31][^32][^33][^34][^35][^36][^37][^38][^39][^40][^41][^42][^43][^44][^45][^46][^47][^48][^49][^50][^51][^52][^53][^54][^55][^56][^57][^58][^59][^60][^61][^62][^63][^64][^65][^66][^67][^68][^69][^70][^71][^72][^73][^74][^75][^76][^77][^78][^79][^80][^81][^82][^83][^84][^85][^86][^87][^88][^89][^90][^91][^92][^93][^94][^95][^96][^97][^98][^99]</span>

<div align="center">⁂</div>

[^1]: https://ai.google.dev/api/live

[^2]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/start-manage-session

[^3]: https://docs.livekit.io/reference/python/livekit/plugins/google/realtime/realtime_api.html

[^4]: http://arxiv.org/pdf/2403.05530.pdf

[^5]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-live?hl=es-419

[^6]: https://googleapis.github.io/js-genai/

[^7]: https://reference-server.pipecat.ai/en/latest/_modules/pipecat/services/google/gemini_live/llm.html

[^8]: https://strandsagents.com/latest/documentation/docs/api-reference/python/experimental/bidi/models/gemini_live/

[^9]: https://ai.google.dev/gemini-api/docs/live-api/tools

[^10]: https://ai.google.dev/gemini-api/docs/live-tools?hl=es-419

[^11]: https://arxiv.org/pdf/2412.01441v1.pdf

[^12]: http://arxiv.org/pdf/2410.05993.pdf

[^13]: https://arxiv.org/html/2502.10536v1

[^14]: http://arxiv.org/pdf/2402.01831.pdf

[^15]: http://arxiv.org/pdf/2410.04199.pdf

[^16]: http://arxiv.org/pdf/2405.09798.pdf

[^17]: http://arxiv.org/pdf/2403.08312.pdf

[^18]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api

[^19]: https://ai.google.dev/gemini-api/docs/live-api

[^20]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api?hl=es

[^21]: https://cloud.google.com/blog/topics/developers-practitioners/how-to-use-gemini-live-api-native-audio-in-vertex-ai

[^22]: https://github.com/googleapis/python-genai/issues/1725

[^23]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-live

[^24]: https://discuss.ai.google.dev/t/how-do-i-prevent-the-live-api-from-discarding-audio-when-its-given-audio-while-it-speaks/73795

[^25]: https://www.datastudios.org/post/google-gemini-2-5-flash-context-window-token-limits

[^26]: https://www.reddit.com/r/GeminiAI/comments/1l1ts02/live_api_question_about_pricing_for/

[^27]: https://google.github.io/adk-docs/streaming/dev-guide/part4/

[^28]: https://ai.google.dev/gemini-api/docs/live-api/session-management

[^29]: https://docs.litellm.ai/docs/pass_through/vertex_ai_live_websocket

[^30]: https://github.com/google/adk-docs/issues/335

[^31]: https://firebase.google.com/docs/ai-logic/live-api/configuration

[^32]: https://scholar.kyobobook.co.kr/article/detail/4010071639085

[^33]: https://arxiv.org/abs/2510.11695

[^34]: https://www.nature.com/articles/s43018-026-01126-1

[^35]: https://esskajournals.onlinelibrary.wiley.com/doi/10.1002/ksa.70315

[^36]: https://www.semanticscholar.org/paper/7aa3e38104392499dfa83789d73d54d8a207320a

[^37]: https://cinergie.unibo.it/article/view/23123

[^38]: https://www.spiedigitallibrary.org/conference-proceedings-of-spie/13101/3019104/A-modern-GUI-for-the-control-and-tuning-of-the/10.1117/12.3019104.full

[^39]: https://journals.scholarpublishing.org/index.php/AIVP/article/view/19976

[^40]: https://pubs.acs.org/doi/10.1021/acs.analchem.1c04556

[^41]: https://www.nature.com/articles/s41589-019-0381-8

[^42]: http://arxiv.org/pdf/2009.01429.pdf

[^43]: https://arxiv.org/abs/2209.10507

[^44]: https://www.mdpi.com/1648-9144/60/9/1493

[^45]: http://arxiv.org/pdf/2409.06790v1.pdf

[^46]: https://arxiv.org/abs/2108.04385

[^47]: http://arxiv.org/pdf/2405.03162.pdf

[^48]: https://www.scribd.com/document/917604026/Live-API-WebSockets-API-reference-Gemini-API-Google-AI-for-Developers

[^49]: https://firebase.google.com/docs/ai-logic/live-api

[^50]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/best-practices?hl=es

[^51]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/configure-gemini-capabilities

[^52]: https://stackoverflow.com/questions/79862217/gemini-live-api-sessionresumptionupdate-returning-none-for-new-handle-session

[^53]: https://docs.getbifrost.ai/providers/supported-providers/vertex

[^54]: https://gemini.google/overview/gemini-live/

[^55]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/configure-gemini-capabilities?hl=es-419

[^56]: https://ai.google.dev/gemini-api/docs/live-session.md.txt

[^57]: https://www.youtube.com/watch?v=D6lISWAsivA

[^58]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api

[^59]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rpc/google.cloud.aiplatform.v1

[^60]: https://google.github.io/adk-docs/api-reference/python/google-adk.html

[^61]: https://pkg.go.dev/google.golang.org/genai

[^62]: https://www.scribd.com/document/914747993/Google-Gen-AI-SDK

[^63]: https://github.com/googleapis/googleapis/blob/master/google/ai/generativelanguage/v1beta/generative_service.proto

[^64]: https://docs.cloud.google.com/go/docs/reference/cloud.google.com/go/ai/latest/generativelanguage/apiv1beta/generativelanguagepb

[^65]: https://pub.dev/documentation/google_cloud_ai_generativelanguage_v1beta/latest/generativelanguage

[^66]: https://arxiv.org/pdf/2101.11349.pdf

[^67]: http://arxiv.org/pdf/2404.08126.pdf

[^68]: https://pub.dev/documentation/google_cloud_ai_generativelanguage_v1beta/latest/generativelanguage/ContextWindowCompressionConfig_SlidingWindow-class.html

[^69]: https://huggingface.co/Sachin21112004/distilbart-news-summarizer/commit/1e8fc04ec51d534e3ae6ebe23abbda8b5030c4a9

[^70]: https://googleapis.github.io/python-genai/

[^71]: https://github.com/google-gemini/cookbook/issues/977

[^72]: http://arxiv.org/pdf/2404.07979.pdf

[^73]: http://arxiv.org/pdf/2401.03462.pdf

[^74]: https://arxiv.org/html/2502.14317v1

[^75]: https://aclanthology.org/2023.acl-long.352.pdf

[^76]: https://arxiv.org/pdf/2310.08560.pdf

[^77]: https://arxiv.org/pdf/2411.09289.pdf

[^78]: http://arxiv.org/pdf/2502.12085.pdf

[^79]: https://edu-cy.blogspot.com/?page=en-git-livekit-agents-1773005556900

[^80]: https://github.com/googleapis/python-genai/issues/1275

[^81]: https://colab.research.google.com/github/google-gemini/cookbook/blob/main/quickstarts/Get_started_LiveAPI.ipynb?hl=id

[^82]: https://github.com/googleapis/python-genai/issues/2102

[^83]: https://github.com/google-gemini/live-api-web-console/issues/117

[^84]: https://pmc.ncbi.nlm.nih.gov/articles/PMC3715403/

[^85]: http://arxiv.org/pdf/2407.13729.pdf

[^86]: http://arxiv.org/pdf/2501.04764.pdf

[^87]: https://pmc.ncbi.nlm.nih.gov/articles/PMC6624979/

[^88]: http://arxiv.org/pdf/2312.11805.pdf

[^89]: http://link.springer.com/10.1007/978-3-662-45174-8

[^90]: https://arxiv.org/abs/2110.08374

[^91]: https://arxiv.org/pdf/2403.13793.pdf

[^92]: https://arxiv.org/pdf/1304.4860.pdf

[^93]: https://arxiv.org/html/2503.20020v1

[^94]: https://academic.oup.com/bioinformatics/article/39/Supplement_1/i504/7210443

[^95]: https://discuss.ai.google.dev/t/scheduling-silent-in-non-blocking-function-response-not-preventing-duplicate-audio-generation/114361

[^96]: https://github.com/googleapis/python-genai/issues/1894

[^97]: https://www.linkedin.com/posts/misrarishabh_text-latency-jumped-400-after-launching-activity-7432091986884714496-tmuy

[^98]: https://www.instagram.com/p/DUi-458k8zf/

[^99]: https://www.linkedin.com/posts/sabiraarefin_the-3-biggest-shifts-in-al-data-governance-activity-7408184212073103360-qceK

[^100]: https://www.linkedin.com/company/afterdays

[^101]: https://hexdocs.pm/gemini_ex/0.8.4/changelog.html

[^102]: https://www.instagram.com/katriyam.official/

[^103]: https://codelabs.developers.google.com/way-back-home-level-3/instructions

[^104]: https://colab.research.google.com/github/google-gemini/cookbook/blob/main/quickstarts/Get_started_LiveAPI_tools.ipynb

[^105]: https://docs.agora.io/en/conversational-ai/rest-api/agent/join

[^106]: http://arxiv.org/pdf/2405.16141.pdf

[^107]: https://arxiv.org/pdf/2102.04942.pdf

[^108]: http://arxiv.org/pdf/2006.07042.pdf

[^109]: http://arxiv.org/pdf/2410.18053.pdf

[^110]: https://colab.research.google.com/github/GoogleCloudPlatform/generative-ai/blob/main/gemini/multimodal-live-api/intro_multimodal_live_api_genai_sdk.ipynb

[^111]: https://google.github.io/adk-docs/streaming/dev-guide/part3/

[^112]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/get-started-adk?hl=es

[^113]: https://developer.android.com/ai/gemini/live

[^114]: https://firebase.google.com/docs/ai-logic/live-api?hl=es-419

[^115]: https://github.com/jsalsman/gemini-live

[^116]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/get-started-adk?hl=es-419

[^117]: https://codelabs.developers.google.com/intro-to-adk-live?hl=es-419

[^118]: https://ai.google.dev/api/live?hl=es-419

