<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# I'm using Google ADK (Agent Development Kit) v1.26.0 for Python with the Gemini Live API. I want to set behavior: NON_BLOCKING on specific function tools (FunctionDeclaration) so the model can keep talking while tools execute. However, ADK's internal _function_tool_declarations.py doesn't pass the behavior parameter when building declarations.

Is there a supported way in ADK v1.26.0 to set behavior=NON_BLOCKING on a tool? Any agent config, tool config, or decorator?
Can I subclass FunctionTool and override the declaration to add behavior?
Is there a way to set scheduling=SILENT on FunctionResponse through ADK's after_tool_callback or any other hook?
Has anyone in the ADK community solved this — setting NON_BLOCKING on ADK function tools for the Live API?
As of March 2026. Include sources from ADK docs, GitHub issues, or discussions.

As of ADK Python v1.26.0, there is no documented or supported way to mark ADK function tools as `behavior=NON_BLOCKING` or to set `FunctionResponse.scheduling` (for example `SILENT`) via normal agent config, tool config, or callbacks when using the Gemini Live API.[^1][^2]

Below are answers to each of your sub‑questions, with what is currently possible and what people have tried.

***

## What NON_BLOCKING and scheduling actually are

In the raw Gemini / Vertex APIs, tools are described by `FunctionDeclaration` objects that can include a `behavior` field (`BLOCKING` or `NON_BLOCKING`).[^2][^3]

- `behavior: NON_BLOCKING` tells the model not to wait for the tool result before continuing the conversation; tool results are folded in later via `FunctionResponse` messages.[^3][^2]
- A `FunctionResponse` can carry a `response` payload that includes a `scheduling` field: `SILENT`, `WHEN_IDLE`, or `INTERRUPT`, which controls whether the tool result should be silently added to context, applied when the model is idle, or interrupt current generation.[^2][^3]

The official Live API docs and examples show this pattern explicitly (e.g., Python/JS snippets where a function declaration is created with `behavior: "NON_BLOCKING"`, and tool responses are sent back with `scheduling: FunctionResponseScheduling.SILENT|WHEN_IDLE|INTERRUPT`).[^3][^4]

***

## What ADK exposes for function tools

ADK’s function‑tool docs describe how Python functions are wrapped into `FunctionTool` automatically when you put them into an agent’s `tools` list.[^1]

Key points from those docs:

- The tool schema is inferred from the function’s name, docstring, type hints, and defaults; this becomes the `FunctionDeclaration` the model sees.[^1]
- Return values are plain Python `dict`s; ADK wraps non‑dict returns into `{"result": ...}` for you.[^1]
- For “background” or long tasks, ADK introduces **LongRunningFunctionTool**, which pauses the agent and lets your application later send back an updated `FunctionResponse` (e.g., status/progress) to resume the flow.[^1]

Nowhere in the function‑tools or long‑running‑tools docs is there any parameter or option to set `behavior` to `NON_BLOCKING`, nor is `Behavior` mentioned at all.[^1]

The Gemini Live API Toolkit docs for ADK focus on streaming, `LiveRequestQueue`, and `run_live`, but they likewise never mention any way to adjust `FunctionDeclaration.behavior` or `FunctionResponse.scheduling` from ADK.[^5][^6]

***

## 1. Can you set `behavior=NON_BLOCKING` for an ADK tool?

From the public surface area (Python API, agent config, and callbacks):

- Function tools: there is no keyword argument, attribute, or decorator documented that controls `behavior` for `FunctionDeclaration`.[^1]
- Agent config / YAML / JSON: the AgentConfig‑style documentation that mentions “only applicable to NON_BLOCKING function calls (see FunctionDeclaration.behavior)” is describing the *underlying* model types, not an ADK‑level knob you can set for individual tools.[^7][^2]
- Callbacks: the callback docs (`before_tool_callback`, `after_tool_callback`, etc.) operate on tool args and the *dict result*, not on the generated `FunctionDeclaration`.[^8][^9][^10]

I was not able to find:

- Any ADK doc that shows a function tool being created with a `behavior` parameter.
- Any sample in ADK’s Live toolkit that annotates tools as `NON_BLOCKING`.
- Any GitHub issue or discussion in `google/adk-python` showing a supported pattern for turning on `NON_BLOCKING` for individual tools.

Given that and the fact that the function‑tools reference explains in detail how the schema is inferred but never exposes a behavior flag, the current state is:

> **As of ADK Python v1.26.0, there is no supported public API in ADK to mark a function tool’s `FunctionDeclaration.behavior` as `NON_BLOCKING`.**[^5][^1]

If you *must* use `NON_BLOCKING` today, the only documented route is to bypass ADK for that part of your stack and use the raw `@google/genai` Live client (or Vertex Live client) directly, where you can build `functionDeclarations` with `behavior: NON_BLOCKING` yourself.[^3][^2]

***

## 2. Can you subclass `FunctionTool` and override the declaration?

ADK does support writing custom tools by subclassing the generic tool base classes (`BaseTool` in Python, `FunctionTool` in TypeScript/Java), but the official Python docs focus on:

- Plain Python functions auto‑wrapped as `FunctionTool`, and
- Explicit `LongRunningFunctionTool` wrappers.[^1]

The docs do **not** describe any supported extension point where you:

- Override a method that returns a custom `FunctionDeclaration`, or
- Inject additional fields like `behavior` into the declaration from user code.[^1]

The callback and context docs make clear that the *supported* way to customize tool behavior in ADK is:

- **Before/after tool callbacks**: `before_tool_callback` and `after_tool_callback` to validate/transform args and results. These callbacks see `tool: BaseTool`, `args: dict`, and the raw `tool_response: dict`, and can return a replacement dict; they don’t receive or return a `FunctionDeclaration` or `FunctionResponse` object.[^9][^10][^8]

Because the declaration‑building logic is in ADK’s internal “function tool declarations” machinery and is not documented as overridable, using inheritance to try to smuggle in a `behavior` field would be:

- **Undocumented** – not covered by the public API docs.
- **Brittle** – internal helpers and caches (e.g., canonical tools cache) may ignore or overwrite anything you add.[^11][^8]

I couldn’t find any official example, blog post, or issue comment from the ADK team recommending subclassing `FunctionTool` to alter `FunctionDeclaration` for Live‑specific fields, and no code sample where this works reliably.[^5][^1]

> So: you could experiment with a private hack (e.g., writing your own `BaseTool` that talks directly to Live), but subclassing ADK’s `FunctionTool` specifically to set `behavior` is **not a supported pattern** and may silently break across versions.

***

## 3. Can `after_tool_callback` (or similar) set `scheduling="SILENT"`?

Two important pieces:

1. **How scheduling is supposed to work in the Gemini APIs**
Live tools docs show you send a tool result back as a `FunctionResponse` with a `response` payload that includes `scheduling: FunctionResponseScheduling.SILENT|WHEN_IDLE|INTERRUPT`.[^3][^2]
2. **What ADK actually gives you in callbacks**
    - `after_tool_callback` for an agent is documented as a hook that receives `(tool, args, tool_context, tool_response)` and may return a new `dict` to replace the tool’s result.[^10][^9]
    - The `tool_response` here is the *logical* result of the Python function (a `dict`), not the low‑level `FunctionResponse` proto that ADK later wraps and sends to Gemini.[^9][^1]

That means:

- You can change the content of the tool’s result `dict` (e.g., add keys like `"status": "ok"` or reshape it), and ADK will pack that into `FunctionResponse.response` for you.[^9][^1]
- But you *cannot* from `after_tool_callback` say “also set `scheduling=SILENT` on the `FunctionResponse`” because that field lives one level down in the generated message that ADK constructs after your callback has run. The callback API has no parameter or return type for that.[^10][^9]

There is at least one public note from a developer experimenting with Gemini Live + ADK who explicitly mentions trying to get `scheduling="SILENT"` to work via the ADK layer and via `after_tool_callback`, and reports that it does not take effect (“scheduling=\"SILENT\" … I tried to set it from the ADK layer, but it’s not working; I fiddled with it in after_tool_callback but no luck”).[^12]

So for **standard ADK automatic tool execution**, the answer is:

> **No – there is no supported way to set `FunctionResponse.scheduling` (e.g., `SILENT`) via `after_tool_callback` or any other documented callback hook.**[^12][^9]

### One narrow exception: manual LongRunningFunctionTool flow

The long‑running tools example in the ADK docs shows a manual pattern where your app:

1. Lets a `LongRunningFunctionTool` fire.
2. Receives an event that contains a `FunctionCall` and later a `FunctionResponse`.
3. Clones that `FunctionResponse` object, mutates the `response` field, and sends it back in a new `Content` message `Part(function_response=updated_response)` via the runner.[^1]

In *that* pattern you’re working directly with `types.FunctionResponse` from the underlying SDK, so in principle you could also add `scheduling: "SILENT"` to `updated_response.response` before you send it back.[^2][^1]

However:

- This only applies to manually‑managed long‑running flows, not to normal synchronous tools.
- There are Live‑API‑level quirks: at least one Live API user reported that even with `behavior=NON_BLOCKING` and `scheduling=WHEN_IDLE` the model would still generate extra spoken output they didn’t want, i.e., scheduling is not yet a complete guardrail against “answering its own question.”[^13]

***

## 4. Has anyone “solved” NON_BLOCKING tools in ADK for Live?

From what’s publicly visible as of March 2026:

- The official Gemini Live tools docs *do* show `behavior: NON_BLOCKING` and `FunctionResponse.scheduling` – but only in raw SDK examples, not ADK.[^4][^3][^2]
- The ADK docs and samples for:
    - function tools,
    - long‑running tools, and
    - Gemini Live API Toolkit

never demonstrate or mention enabling `NON_BLOCKING` behavior on a tool through ADK.[^6][^5][^1]
- Community experiments around Live + ADK that are publicly discussed either:
    - work entirely at the raw `@google/genai` / python‑genai layer to use `NON_BLOCKING`, or
    - mention trying to control `scheduling` from ADK and failing (as in the Japanese Scrapbox note).[^13][^12]

I did **not** find:

- Any ADK sample repository, codelab, or blog post where a Python ADK agent uses a function tool with `behavior=NON_BLOCKING`.
- Any GitHub issue or forum thread where a maintainer confirms “here’s how to set `behavior=NON_BLOCKING` for an ADK tool in Live” or where a user reports a working end‑to‑end pattern that only uses ADK with no raw Live calls.

Given that absence, plus the shape of the documented APIs, the current state of the ecosystem looks like:

> **No, there is no publicly documented or community‑accepted solution for marking ADK function tools as `NON_BLOCKING` in Gemini Live as of March 2026.** ADK’s supported “non‑blocking” patterns are its own long‑running tools and parallel/async function execution, not the Live API’s `behavior=NON_BLOCKING` flag.[^6][^5][^1]

***

## Practical options today

If your goal is “let the model keep talking while tools run” with ADK + Live, your realistic choices today are:

- **Use ADK’s LongRunningFunctionTool** and design your flow around pausing and resuming with explicit status updates, rather than relying on Live’s `NON_BLOCKING` machinery.[^1]
- **Drop down to the raw Live API** (e.g., via `@google/genai` / `python-genai`) for the specific parts of your app that need true Live `NON_BLOCKING` tools and scheduling control, and keep ADK for higher‑level orchestration elsewhere.[^3][^2]
- **Accept blocking tools in ADK** but offload heavy work to your own async infrastructure (queues, workers), returning quick “task queued” messages and streaming follow‑ups via separate agent turns. This uses ADK’s standard tool model and state/artifact APIs rather than Live’s scheduling.[^8][^1]

If Google adds first‑class support for `behavior` and `scheduling` in ADK tools later, you should expect it to be reflected in the function‑tools and streaming docs; until then, any solution that mutates ADK’s private declaration machinery is effectively unsupported.
<span style="display:none">[^100][^101][^102][^103][^104][^105][^106][^107][^108][^109][^110][^111][^112][^113][^114][^115][^116][^117][^118][^119][^120][^121][^122][^123][^124][^125][^126][^127][^128][^129][^130][^131][^132][^133][^134][^135][^136][^137][^138][^139][^14][^140][^141][^142][^143][^144][^145][^146][^147][^148][^149][^15][^150][^151][^152][^153][^154][^155][^156][^157][^158][^159][^16][^160][^161][^162][^163][^164][^165][^166][^167][^168][^169][^17][^170][^171][^172][^173][^174][^175][^176][^177][^178][^179][^18][^180][^181][^182][^183][^184][^185][^186][^187][^188][^189][^19][^190][^191][^192][^193][^194][^195][^196][^197][^198][^199][^20][^200][^201][^202][^203][^204][^205][^206][^207][^208][^209][^21][^210][^211][^212][^213][^214][^215][^216][^217][^218][^219][^22][^220][^221][^222][^223][^224][^225][^226][^227][^228][^23][^24][^25][^26][^27][^28][^29][^30][^31][^32][^33][^34][^35][^36][^37][^38][^39][^40][^41][^42][^43][^44][^45][^46][^47][^48][^49][^50][^51][^52][^53][^54][^55][^56][^57][^58][^59][^60][^61][^62][^63][^64][^65][^66][^67][^68][^69][^70][^71][^72][^73][^74][^75][^76][^77][^78][^79][^80][^81][^82][^83][^84][^85][^86][^87][^88][^89][^90][^91][^92][^93][^94][^95][^96][^97][^98][^99]</span>

<div align="center">⁂</div>

[^1]: https://google.github.io/adk-docs/tools-custom/function-tools/

[^2]: https://ai.google.dev/api/caching

[^3]: https://gemini.cadn.net.cn/gemini-api/docs/live-tools.html

[^4]: https://ai.google.dev/gemini-api/docs/live-tools?hl=es-419

[^5]: https://google.github.io/adk-docs/streaming/dev-guide/part1/

[^6]: https://google.github.io/adk-docs/streaming/

[^7]: https://adk.wiki/api-reference/agentconfig/

[^8]: https://google.github.io/adk-docs/context/

[^9]: https://google.github.io/adk-docs/callbacks/

[^10]: https://google.github.io/adk-docs/callbacks/types-of-callbacks/

[^11]: https://joss.theoj.org/papers/10.21105/joss.05100.pdf

[^12]: https://scrapbox.io/pokutuna/2025%2F10_Gemini_Live_%E3%81%A7%E9%81%8A%E3%81%B6

[^13]: https://discuss.ai.google.dev/t/gemini-live-api-answering-its-own-question/120257

[^14]: https://arxiv.org/pdf/2311.17688.pdf

[^15]: https://arxiv.org/pdf/2403.17918.pdf

[^16]: https://arxiv.org/html/2408.15247v1

[^17]: http://arxiv.org/pdf/2402.01030.pdf

[^18]: https://arxiv.org/pdf/2503.18666.pdf

[^19]: https://arxiv.org/pdf/2503.04479.pdf

[^20]: https://arxiv.org/pdf/2312.13010.pdf

[^21]: https://github.com/google/adk-python

[^22]: https://codelabs.developers.google.com/onramp/instructions

[^23]: https://docs.cloud.google.com/agent-builder/agent-development-kit/overview?hl=es

[^24]: https://www.youtube.com/watch?v=wgOCzHXKw4c

[^25]: https://discuss.ai.google.dev/t/scheduling-silent-in-non-blocking-function-response-not-preventing-duplicate-audio-generation/114361

[^26]: https://github.com/google/adk-python/issues/53

[^27]: https://developers.googleblog.com/building-agents-with-the-adk-and-the-new-interactions-api/

[^28]: https://ai.google.dev/gemini-api/docs/live-tools

[^29]: https://github.com/google/adk-python/issues/969

[^30]: https://www.reddit.com/r/LocalLLaMA/comments/1jvsvzj/just_did_a_deep_dive_into_googles_agent/

[^31]: https://colab.research.google.com/github/google-gemini/cookbook/blob/main/quickstarts/Get_started_LiveAPI_tools.ipynb

[^32]: https://github.com/google/adk-python/issues/4685

[^33]: https://lobehub.com/es/skills/samhvw8-dot-claude-google-adk-python

[^34]: https://ai.google.dev/gemini-api/docs/live-api/tools?hl=es-419

[^35]: https://academic.oup.com/bioinformatics/article/doi/10.1093/bioinformatics/btaf420/8220315

[^36]: https://xlink.rsc.org/?DOI=D5DD00201J

[^37]: https://ieeexplore.ieee.org/document/7892210/

[^38]: https://www.semanticscholar.org/paper/43968173fce5e0cdb61bc29698415180f2ad396a

[^39]: https://www.semanticscholar.org/paper/d7b17ea2a15f217ff21c87fb82189da0c521c5fe

[^40]: http://doi.ieeecomputersociety.org/10.1109/CAHPC.2004.3

[^41]: https://www.semanticscholar.org/paper/b5bf911fdd56bb2c8c850f7a5c626c4beb9ca966

[^42]: http://ieeexplore.ieee.org/document/1592568/

[^43]: https://arxiv.org/pdf/1007.1722.pdf

[^44]: https://www.aclweb.org/anthology/D17-2012.pdf

[^45]: http://arxiv.org/pdf/1511.00916.pdf

[^46]: https://pmc.ncbi.nlm.nih.gov/articles/PMC6489977/

[^47]: https://arxiv.org/pdf/2304.09733.pdf

[^48]: https://www.jstatsoft.org/index.php/jss/article/download/v109i02/4562

[^49]: https://arxiv.org/pdf/1705.08169.pdf

[^50]: https://arxiv.org/pdf/2501.18327.pdf

[^51]: https://github.com/google/adk-python/issues/3275

[^52]: https://github.com/google/adk-python/blob/main/src/google/adk/tools/function_tool.py

[^53]: https://dev.to/pasmichal/how-to-pass-data-from-a-function-tool-to-state-in-adk-agent-development-kit-2p2n

[^54]: https://google.github.io/adk-docs/api-reference/python/google-adk.html

[^55]: https://www.scribd.com/document/955815478/ADK

[^56]: https://google.github.io/adk-docs/agents/llm-agents/

[^57]: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-dg.pdf

[^58]: https://github.com/google/adk-python/discussions/4279

[^59]: https://www.linkedin.com/posts/tanmay-khule-523705250_ironman-github-coding-activity-7338211655446687745-aJs6

[^60]: https://google.github.io/adk-docs/get-started/quickstart/

[^61]: https://community.agno.com/t/support-for-event-triggers/941

[^62]: https://google.github.io/adk-docs/api-reference/python/

[^63]: https://www.der-windows-papst.de/wp-content/uploads/2019/07/Windows-10-Deploy-an-update.pdf

[^64]: https://arxiv.org/pdf/2101.11003.pdf

[^65]: http://arxiv.org/pdf/2208.06318.pdf

[^66]: https://dl.acm.org/doi/pdf/10.1145/3611643.3616364

[^67]: https://arxiv.org/pdf/2308.13276.pdf

[^68]: https://arxiv.org/pdf/1812.04894.pdf

[^69]: http://arxiv.org/pdf/1702.04872.pdf

[^70]: https://arxiv.org/pdf/2501.04963.pdf

[^71]: https://myteam.exceeds.ai/profile/xuanyang15

[^72]: https://arjunprabhulal.com/adk-custom-tools-function/

[^73]: https://github.com/miguelgrinberg/microdot/discussions/252

[^74]: https://lobehub.com/ar/skills/frankxai-ai-and-web3-oracle-agent-spec

[^75]: https://docs.pytorch.org/tutorials/intermediate/pinmem_nonblock.html

[^76]: https://codelabs.developers.google.com/multi-tools-ai-agent-adk?hl=es-419

[^77]: https://stackoverflow.com/questions/63460538/proper-usage-of-pytorchs-non-blocking-true-for-data-prefetching

[^78]: https://jonathanc.net/blog/maximizing_pytorch_throughput

[^79]: https://www.reddit.com/r/MLQuestions/comments/qr0s76/how_to_avoid_cpu_bottlenecking_in_pytorch/

[^80]: http://arxiv.org/pdf/1707.02275v1.pdf

[^81]: https://joss.theoj.org/papers/10.21105/joss.01277.pdf

[^82]: https://arxiv.org/pdf/2401.13150.pdf

[^83]: https://pypi.org/project/google-adk/

[^84]: https://cloud.google.com/blog/topics/developers-practitioners/tools-make-an-agent-from-zero-to-assistant-with-adk

[^85]: https://lobehub.com/skills/frankxai-ai-and-web3-oracle-agent-spec/

[^86]: https://langwatch.ai/docs/integration/python/integrations/google-ai

[^87]: https://lobehub.com/fr/skills/frankxai-ai-and-web3-oracle-agent-spec

[^88]: https://docs.langdb.ai/guides/building-agents/building-web-search-agent-with-google-adk

[^89]: http://arxiv.org/pdf/2404.01318v2.pdf

[^90]: http://arxiv.org/pdf/2412.10922.pdf

[^91]: https://arxiv.org/abs/2110.08374

[^92]: https://arxiv.org/pdf/2306.08134.pdf

[^93]: http://arxiv.org/pdf/2407.13729.pdf

[^94]: https://arxiv.org/pdf/2312.05052.pdf

[^95]: http://arxiv.org/pdf/2308.03825v2.pdf

[^96]: https://arxiv.org/pdf/2311.09127.pdf

[^97]: https://github.com/googleapis/python-genai/issues/2117

[^98]: https://docs.cloud.google.com/agent-builder/agent-engine/memory-bank/quickstart-adk?hl=es

[^99]: https://dev.to/jnth/google-agent-sdk-introduction-2-building-a-multi-agent-meeting-scheduling-system-1ach

[^100]: https://www.youtube.com/watch?v=z8Q3qLi9m78

[^101]: https://github.com/livekit/agents/issues/2367

[^102]: https://google.github.io/adk-docs/events/

[^103]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-live

[^104]: https://silentinstallhq.com/windows-adk-for-windows-11-version-22h2-silent-install-how-to-guide/

[^105]: https://dev.to/jxlee007/enhancing-natural-flow-in-gemini-live-testing-interruptions-and-a-proposed-context-layer-43ll

[^106]: https://www.advancedinstaller.com/forums/viewtopic.php?t=47217

[^107]: https://github.com/googleapis/python-genai/issues/1739

[^108]: https://www.reddit.com/r/sysadmin/comments/1i6fd63/how_does_one_really_make_a_driver_quiet_install/

[^109]: https://pmc.ncbi.nlm.nih.gov/articles/PMC3698936/

[^110]: https://pmc.ncbi.nlm.nih.gov/articles/PMC7752304/

[^111]: https://pmc.ncbi.nlm.nih.gov/articles/PMC5148215/

[^112]: https://pmc.ncbi.nlm.nih.gov/articles/PMC5071315/

[^113]: https://pmc.ncbi.nlm.nih.gov/articles/PMC3137468/

[^114]: https://pmc.ncbi.nlm.nih.gov/articles/PMC8096637/

[^115]: https://pmc.ncbi.nlm.nih.gov/articles/PMC322029/

[^116]: https://stackoverflow.com/questions/38686084/how-to-create-a-non-blocking-function

[^117]: https://github.com/google/adk-python/blob/main/contributing/samples/parallel_functions/README.md

[^118]: https://www.reddit.com/r/Python/comments/33pq5w/non_blocking_rest_calls_in_python/

[^119]: https://codelabs.developers.google.com/intro-to-adk-live?hl=en

[^120]: https://www.youtube.com/watch?v=U6SZGdwb1h0

[^121]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/get-started-adk

[^122]: https://github.com/google/adk-python/issues/1212

[^123]: https://www.youtube.com/watch?v=3zGGC_uYjoE

[^124]: https://www.mdpi.com/1422-0067/26/24/12184

[^125]: https://www.pharmacokinetica.ru/jour/article/view/459

[^126]: https://www.nature.com/articles/s41421-025-00830-z

[^127]: https://linkinghub.elsevier.com/retrieve/pii/S2090123224002984

[^128]: https://linkinghub.elsevier.com/retrieve/pii/S0306452224000873

[^129]: https://linkinghub.elsevier.com/retrieve/pii/S037811192400194X

[^130]: https://journal.arteii.or.id/index.php/bumi/article/view/61

[^131]: https://www.pharmacokinetica.ru/jour/article/view/408

[^132]: https://linkinghub.elsevier.com/retrieve/pii/S0753332224012460

[^133]: https://link.springer.com/10.1134/S1022795424700273

[^134]: https://arxiv.org/pdf/2404.01858.pdf

[^135]: http://arxiv.org/pdf/1808.01729.pdf

[^136]: http://arxiv.org/pdf/2412.08654.pdf

[^137]: http://arxiv.org/pdf/1504.02001.pdf

[^138]: https://arxiv.org/pdf/2502.11904.pdf

[^139]: https://arxiv.org/pdf/2111.08684.pdf

[^140]: https://dl.acm.org/doi/pdf/10.1145/3594671.3594678

[^141]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/Content

[^142]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rpc/google.cloud.aiplatform.v1

[^143]: https://tessl.io/registry/tessl/npm-google--genai/1.30.0/files/docs/function-calling.md

[^144]: https://www.scribd.com/document/914747993/Google-Gen-AI-SDK

[^145]: https://ai-navigate-news.com/articles/0b331d3d-99d3-4892-91ef-50a7db1031b6

[^146]: https://docs.sammylabs.com/features/tools

[^147]: https://gist.github.com/hayesraffle/ab09fc7d21a5df3a01b0f69fb353280c

[^148]: https://qiita.com/o0-sheeefk-0o/items/14d59bcf750f17fe5db0

[^149]: https://link.springer.com/10.1023/A:1025859021913

[^150]: https://ieeexplore.ieee.org/document/643237/

[^151]: https://www.semanticscholar.org/paper/e09405090226b6495b7d2f6d3d467505425076dd

[^152]: https://ascopubs.org/doi/10.1200/GO.23.00294

[^153]: https://ieeexplore.ieee.org/document/10487216/

[^154]: https://linkinghub.elsevier.com/retrieve/pii/S0969804320306278

[^155]: https://www.semanticscholar.org/paper/97475b40a92cce6141f310e6f769904bd759c9a6

[^156]: https://ascopubs.org/doi/10.1200/GO.22.00117

[^157]: https://academic.oup.com/jaoac/article/105/5/1428/6589899

[^158]: http://link.springer.com/10.1007/3-540-45941-3_13

[^159]: https://arxiv.org/abs/2503.11444

[^160]: https://arxiv.org/pdf/1111.5930.pdf

[^161]: https://aclanthology.org/2023.emnlp-demo.51.pdf

[^162]: http://arxiv.org/pdf/2403.03031.pdf

[^163]: https://arxiv.org/pdf/2404.11483.pdf

[^164]: https://arxiv.org/html/2412.08445

[^165]: https://arxiv.org/pdf/2309.07870.pdf

[^166]: https://cloud.google.com/blog/products/ai-machine-learning/build-a-deep-research-agent-with-google-adk

[^167]: https://www.youtube.com/watch?v=yhUlAl08kII

[^168]: https://www.firecrawl.dev/blog/google-adk-multi-agent-tutorial

[^169]: https://github.com/google/adk-python/issues/1121

[^170]: https://google.github.io/adk-docs/plugins/

[^171]: https://codelabs.developers.google.com/codelabs/agent-memory/instructions

[^172]: https://agentfactory.panaversity.org/docs/Building-Custom-Agents/google-adk-reliable-agents/callbacks-guardrails

[^173]: https://developers.googleblog.com/beyond-request-response-architecting-real-time-bidirectional-streaming-multi-agent-system/

[^174]: https://arjunprabhulal.com/adk-callbacks/

[^175]: https://www.youtube.com/watch?v=Ee1Y7gwvhy8

[^176]: https://agentfactory.panaversity.org/docs/Building-Custom-Agents/google-adk-reliable-agents

[^177]: https://codelabs.developers.google.com/adk-multimodal-tool-part-2?hl=es-419

[^178]: https://openaccess.cms-conferences.org/publications/book/978-1-964867-73-1/article/978-1-964867-73-1_13

[^179]: https://ieeexplore.ieee.org/document/9663885/

[^180]: https://arxiv.org/abs/2510.11174

[^181]: https://arxiv.org/abs/2601.22569

[^182]: https://linkinghub.elsevier.com/retrieve/pii/S0028390818305586

[^183]: https://iubmb.onlinelibrary.wiley.com/doi/10.1002/iub.2905

[^184]: https://linkinghub.elsevier.com/retrieve/pii/S0920121124000184

[^185]: https://www.semanticscholar.org/paper/fe9b54d5346e6e9720d96d3241df289f8bccd67f

[^186]: https://www.frontiersin.org/articles/10.3389/frdem.2025.1601462/full

[^187]: https://arxiv.org/pdf/1803.02700.pdf

[^188]: http://arxiv.org/pdf/2211.07185.pdf

[^189]: https://arxiv.org/pdf/2309.05169.pdf

[^190]: http://arxiv.org/pdf/2401.17618.pdf

[^191]: https://www.mdpi.com/1424-8220/24/16/5118/pdf?version=1723216189

[^192]: https://arxiv.org/pdf/2212.04326.pdf

[^193]: http://arxiv.org/pdf/2503.09282.pdf

[^194]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1beta1/Content

[^195]: https://www.reddit.com/r/AI_Agents/comments/1rnjujd/google_adk_is_seriously_underrated_for_building/

[^196]: https://www.kaggle.com/code/talhasayyed1995/resumeanalyseagent

[^197]: https://www.linkedin.com/posts/shen-sean-chen_i-just-released-an-open-source-ai-agentic-activity-7404590485027053568-NbZD

[^198]: https://docs.cloud.google.com/customer-engagement-ai/conversational-agents/ps/best-practices

[^199]: https://www.kaggle.com/competitions/agents-intensive-capstone-project/writeups/smartcommunity-ai-multi-agent-intelligent-concier

[^200]: https://www.linkedin.com/posts/rkc1983_googleadk-agenticai-aiagents-activity-7421734710176964608-17yW

[^201]: https://docs.cloud.google.com/customer-engagement-ai/conversational-agents/ps/best-practices?hl=zh-TW

[^202]: https://google.github.io/adk-docs/llms-full.txt

[^203]: https://www.facebook.com/0xSojalSec/posts/recursive-language-models-google-adk-the-enterprise-path-to-unbounded-context-re/1439688614352204/

[^204]: https://www.ijsr.net/getabstract.php?paperid=SR25915100037

[^205]: https://arxiv.org/abs/2508.10146

[^206]: https://ieeexplore.ieee.org/document/11241317/

[^207]: https://ieeexplore.ieee.org/document/11333875/

[^208]: https://www.semanticscholar.org/paper/a892baf3b42b5462fc5dabd470d9bfdbfaeaae99

[^209]: https://www.semanticscholar.org/paper/8e9426a6ec1d3237dc59d2abef96445fe788f296

[^210]: https://bmcmededuc.biomedcentral.com/articles/10.1186/s12909-025-07258-9

[^211]: https://arxiv.org/pdf/2109.00300.pdf

[^212]: https://arxiv.org/html/2406.17431v2

[^213]: https://arxiv.org/pdf/2208.01968.pdf

[^214]: https://arxiv.org/pdf/1706.05042.pdf

[^215]: http://arxiv.org/pdf/2409.10411.pdf

[^216]: http://arxiv.org/pdf/2410.02809.pdf

[^217]: http://arxiv.org/pdf/1708.02380.pdf

[^218]: http://eudl.eu/pdf/10.4108/ue.1.4.e1

[^219]: https://github.com/google/adk-python/issues/4115

[^220]: https://codelabs.developers.google.com/way-back-home-level-3/instructions

[^221]: https://www.linkedin.com/posts/pratyay-pandey-7b877982_lets-dive-into-how-the-google-adk-uses-reactive-activity-7391127098242916353-hFx9

[^222]: https://www.deepdatamart.com/blog/technology/the-runner-in-google-adk-the-agents-engine-room

[^223]: https://github.com/google/adk-docs/issues/726

[^224]: https://docs.forjinn.com/components-guide/google-adk

[^225]: https://notes.kodekloud.com/docs/Google-ADK/Introduction/Build-your-first-agent/page

[^226]: https://www.linkedin.com/posts/shubhamsaboo_you-can-now-build-google-adk-agents-in-go-activity-7434439192555814913-AqG2

[^227]: https://www.cloudwego.io/docs/eino/overview/eino_adk0_1/

[^228]: https://discuss.google.dev/t/gemini-live-part-1-building-a-low-latency-telephone-voice-agent-with-freeswitch-and-adk-agents-powered-by-gemini-live/332641

