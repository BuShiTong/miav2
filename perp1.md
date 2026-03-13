<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# I'm building a voice agent using Google's Agent Development Kit (ADK) with the Gemini Live API for real-time bidirectional audio streaming. When the model calls multiple tools in a row, each tool result triggers a separate spoken audio response — so the user hears fragmented back-to-back replies instead of one combined answer.

Does the Gemini Live API support sending multiple FunctionResponse parts in a single message to batch tool results together? Is there an ADK or API-level setting that controls this behavior?
Has anyone in the Google AI developer community found a workaround for multiple tool calls producing multiple audio responses in Gemini Live streaming?
What ADK configuration options (RunConfig, LiveRequestQueue, tool_config, function_calling_config) affect how tool responses are grouped or batched before being sent back to the model?
I care about: getting a single combined audio response after multiple tool calls, compatibility with ADK v1.x and gemini-live-2.5-flash, and official API parameters over hacks.
As of March 2026. Please include sources — especially GitHub issues, Google AI docs, or developer forum threads.

You can’t currently make Gemini Live “batch” multiple tool results into a single synthesized audio turn purely by sending multiple `FunctionResponse` parts in one message or by flipping an ADK flag. The behavior you’re seeing (each tool round‑trip leading to its own spoken turn) is a known consequence of how Live + ADK handle tool calls and turn completion as of March 2026.[^1][^2][^3][^4]

## 1. Can one message contain multiple FunctionResponse parts?

At the protocol level, yes: the Live API’s `BidiGenerateContentToolResponse` message has a `function_responses[]` array, and you are expected to send a list of `FunctionResponse` objects in a single tool-response message. Each `FunctionResponse` is matched to a prior `FunctionCall` by `id`.[^2][^5]

However:

- The model treats any `BidiGenerateContentToolResponse` message as “tool results are in, resume generation,” not as a “batch until I say otherwise” construct.[^5][^2]
- If the model issued multiple tool calls sequentially (e.g., one call, then it talks, then another call), you can’t retroactively merge those into one “super turn”; audio will still stream per model turn as the server emits `BidiGenerateContentServerContent` with `turn_complete` markers.[^2]

So: you can batch responses for multiple tool calls that came from the *same* `BidiGenerateContentToolCall` into one `toolResponse` message, but there is no API parameter that says “don’t speak until *all* tool work across multiple calls is done.”[^5][^2]

## 2. Relevant Live / function-calling parameters

The Live API side gives you a few levers, but none are “group tool calls into one audio answer”:

- `BidiGenerateContentSetup.generation_config.response_modalities` – controls whether the model emits text, audio, or both, but not *how many* turns you get.[^2]
- Tool definitions: you can mark some functions `behavior: "NON_BLOCKING"` and then control how their results are injected back using `scheduling` on the `FunctionResponse` (`INTERRUPT`, `WHEN_IDLE`, or `SILENT`).[^5]
    - `SILENT` in particular lets the model *not* immediately speak about a given tool’s result; it can just absorb the data.[^5]
- Turn semantics: Live uses `turn_complete` on `BidiGenerateContentServerContent` to signal when a model turn is done. Audio is streamed as each turn is generated.[^2]

What’s missing is any documented flag in Live (or in the GenAI SDK) that says “only speak once after all tools for this user request are done.”[^2][^5]

## 3. ADK knobs: RunConfig, tool_config, function_calling_config, LiveRequestQueue

In ADK v1.x (and the Gemini Live Toolkit docs), these are the main knobs that affect tool usage, but they still don’t provide batching of spoken responses:

- `RunConfig` (or `GenerateContentConfig` / `LiveConnectConfig` depending on the layer)
    - You can set `response_modalities` to `["AUDIO"]` or `["TEXT","AUDIO"]` and configure speech settings, but there is no documented `tool_batching` or similar option.[^6][^4][^2]
- `tool_config.function_calling_config`
    - You can force tool use (`mode="ANY"`), disable automatic calling, or constrain which functions can be used, but this only changes *whether* and *which* tools are called, not how the resulting turns are grouped in audio.[^7][^8][^4]
- ADK “Gemini Live API Toolkit” plumbing (`run_live`, `LiveRequestQueue`)
    - The reference server shows how to queue events and manage turn‑level streaming, but it doesn’t expose a built‑in switch to suppress intermediate tool-driven turns in favor of a single “final” one; you’d have to implement that policy yourself in your event loop.[^9][^6]

In other words, ADK’s config surface mirrors the underlying Live / tools settings; it does not add an extra “coalesce tool turns into one reply” abstraction.

## 4. What people are actually doing (workarounds)

Recent community write‑ups and forum threads describe essentially three patterns to avoid fragmented spoken replies; all are “architectural” rather than single flags:

1. **Client-side buffering of audio turns**
    - Pattern: don’t play raw audio as you receive it. Instead, accumulate `BidiGenerateContentServerContent` audio chunks in a client buffer until your own “turn is done” heuristic fires (for example, after the final tool call you care about has completed), then stream or play the concatenated audio once.[^6][^5][^2]
    - Cost: you trade latency for coherence; you lose the “instant speak” feeling.
2. **“Silent tools” plus one final answer**
    - Pattern: mark non-user-facing tools as `NON_BLOCKING` and respond with `scheduling: "SILENT"` in their `FunctionResponse`, so the model absorbs results without announcing each one.[^5]
    - Then, once your orchestration layer decides everything is done (for example, after several tools have been called and you’ve computed a composite result), you send a separate user-facing prompt with a single combined answer request. That final turn is what you expose as audio.
    - This is explicitly suggested in community guidance as the way to keep background tools from causing spurious turns.[^3][^5]
3. **“Tools don’t talk” pattern (ADK / Live)**
    - A March 2026 community write‑up on “hard‑won patterns for building voice apps with Gemini Live” recommends *never* feeding raw tool outputs into the conversational context turn‑by‑turn.[^10][^3]
    - Instead:
        - Execute tools under your own control (often via ADK tools or custom handlers).
        - Decide when you want a final, user-facing explanation, and at that point send a summarized context (including tool results) as a single user turn (or system+user combo) to the model, with `response_modalities` including audio.[^3][^6]
    - This prevents each individual tool call from triggering a separate spoken model turn at all—the user only ever hears the final “explain everything” turn.

A closely related gist from March 2026 for Vertex Live describes a similar issue: “turn-taking tool responses pass the filter and get injected as context, prompting a new model turn,” and the suggested fix is to filter those out or mark “wait-for-user” tools specially so they *don’t* cause automatic, spoken follow‑ups.[^11][^12]

## 5. Direct answers to your specific questions

1. **“Does the Gemini Live API support sending multiple FunctionResponse parts in a single message to batch tool results together?”**
    - You *can* send multiple `FunctionResponse` objects in one `BidiGenerateContentToolResponse` (they’re already an array), which is the recommended way to answer multiple function calls issued in a single `toolCall` message.[^2][^5]
    - But this does **not** change the fact that each time you send `toolResponse`, the model is free to begin a new turn, which can produce its own spoken audio. There is no setting that converts several tool‑roundtrips into a single “mega turn.”
2. **“Is there an ADK or API-level setting that controls this behavior?”**
    - No documented flag in Live, the GenAI SDK, or ADK v1.x currently says “aggregate all tool results into one spoken response.”[^4][^6][^5][^2]
    - The closest knobs (`NON_BLOCKING` behavior, `scheduling`, `function_calling_config.mode`, and your own ADK event-handling policies) let you *suppress* or *delay* responses, but the grouping is ultimately something you implement on the client side.[^4][^3][^5]
3. **“Has anyone found a workaround for multiple tool calls producing multiple audio responses?”**
    - Yes, but they’re non-magical:
        - Buffer audio and only play when you deem the interaction “complete.”[^9][^6]
        - Use `NON_BLOCKING` tools with `scheduling: "SILENT"` and then issue a final summarization turn.[^5]
        - Run tools “out of band” (ADK custom tools / in your own code), don’t feed their intermediate outputs into the model as separate turns, and only ask for one final explanation that the user hears.[^11][^3][^6]
4. **“What ADK configuration options affect grouping or batching?”**
    - `RunConfig` / `LiveConnectConfig`: `response_modalities`, speech config, session resumption—*not* turn grouping.[^6][^2]
    - `tool_config.function_calling_config`: controls whether and how tools are picked, not how many spoken turns you get.[^8][^4]
    - `LiveRequestQueue` and `run_live` in the ADK Live Toolkit: give you the place to implement your own policy (e.g., buffer tool calls, gate when model is re-invoked, throttle or merge audio) but don’t automatically merge multiple turns into one.[^13][^6]

Given your constraints (ADK v1.x, `gemini-live-2.5-flash`, and preference for official parameters over hacks), the most robust “official” pattern is:

- Declare tools with `behavior: "NON_BLOCKING"` where appropriate.[^5]
- Respond with `scheduling: "SILENT"` for tools that are just data fetches / computation.[^5]
- Maintain your own state machine in the ADK run handler (or LiveRequestQueue consumer) to track when all necessary tools for a user request are finished.
- Once everything is ready, *then* send a single “please explain the result to the user in speech” turn to Live, and play only that audio to the user.

Would it work for your UX to accept a bit more latency (waiting until all tools complete) in exchange for that single, coherent spoken answer, or do you need partial spoken updates during the tool workflow as well?
<span style="display:none">[^14][^15][^16][^17][^18][^19][^20][^21][^22][^23][^24][^25][^26][^27][^28][^29][^30][^31][^32][^33][^34][^35][^36][^37][^38][^39][^40][^41][^42][^43][^44][^45][^46]</span>

<div align="center">⁂</div>

[^1]: https://www.semanticscholar.org/paper/a2384f3d1c921acaf56e47dfa01f5a7486650c50

[^2]: https://www.semanticscholar.org/paper/2cff21d7b58ea82fd8ca8e283fc49e807764b7ed

[^3]: https://discuss.ai.google.dev/t/hard-won-patterns-for-building-voice-apps-with-gemini-live-march-2026/128155

[^4]: https://google.github.io/adk-docs/tools-custom/function-tools/

[^5]: https://ai.google.dev/gemini-api/docs/live-tools

[^6]: https://google.github.io/adk-docs/streaming/

[^7]: https://github.com/google/adk-python/issues/4179

[^8]: https://ai.google.dev/gemini-api/docs/function-calling

[^9]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/demos

[^10]: https://i10x.ai/news/gemini-live-api-real-time-voice-conversations

[^11]: https://gist.github.com/hayesraffle/ab09fc7d21a5df3a01b0f69fb353280c

[^12]: https://gist.github.com/hayesraffle

[^13]: https://cloud.google.com/blog/products/ai-machine-learning/build-a-real-time-voice-agent-with-gemini-adk

[^14]: https://arxiv.org/pdf/2410.19743.pdf

[^15]: http://arxiv.org/pdf/2412.15660.pdf

[^16]: https://arxiv.org/pdf/2109.01002.pdf

[^17]: https://arxiv.org/pdf/2310.04474.pdf

[^18]: https://arxiv.org/html/2504.07250v1

[^19]: https://arxiv.org/pdf/2306.06624.pdf

[^20]: http://arxiv.org/pdf/2405.17438.pdf

[^21]: http://arxiv.org/pdf/2309.01805.pdf

[^22]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-live

[^23]: https://ai.google.dev/gemini-api/docs/live-api/capabilities

[^24]: https://stackoverflow.com/questions/78389427/how-to-generate-multiple-responses-for-single-prompt-with-google-gemini-api

[^25]: https://firebase.google.com/docs/ai-logic/live-api

[^26]: https://github.com/GoogleCloudPlatform/generative-ai/blob/main/gemini/multimodal-live-api/intro_multimodal_live_api.ipynb

[^27]: https://lablab.ai/ai-tutorials/building-voice-agents-gemini-live-fastapi

[^28]: https://www.philschmid.de/gemini-function-calling

[^29]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/best-practices

[^30]: https://firebase.google.com/docs/ai-logic/function-calling

[^31]: https://stackoverflow.com/questions/79896403/how-to-send-an-array-of-chat-messages-to-google-gemini-api-instead-of-a-single-m

[^32]: https://developers.googleblog.com/beyond-request-response-architecting-real-time-bidirectional-streaming-multi-agent-system/

[^33]: https://arxiv.org/html/2309.13879v2

[^34]: http://arxiv.org/pdf/2409.10999.pdf

[^35]: https://arxiv.org/html/2410.00037v2

[^36]: https://arxiv.org/pdf/2402.03494.pdf

[^37]: http://arxiv.org/pdf/2411.09224.pdf

[^38]: http://arxiv.org/pdf/2306.12925.pdf

[^39]: http://arxiv.org/pdf/2404.14736.pdf

[^40]: https://arxiv.org/pdf/2312.03620.pdf

[^41]: https://codelabs.developers.google.com

[^42]: https://github.com/google/adk-python/discussions/405

[^43]: https://github.com/google-gemini/live-api-web-console/issues/62

[^44]: https://www.youtube.com/watch?v=4xlwlU6h-wM

[^45]: https://deepmind.google/models/gemini-audio/

[^46]: https://github.com/google-gemini/gemini-live-api-examples

