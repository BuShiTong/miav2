<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# We're running a real-time voice agent on Vertex AI using gemini-live-2.5-flash-native-audio with the Live API (BidiGenerateContent). We want to move to Google AI Studio (direct API key access) to use NON_BLOCKING function calling behavior, but need to confirm model availability first.

What Gemini native audio models are currently available as stable (non-preview) for the Live API, and which platforms support them — Google AI Studio vs. Vertex AI?
Is gemini-live-2.5-flash-native-audio specifically available on Google AI Studio, or is it Vertex AI only?
Does Google AI Studio's Live API support NON_BLOCKING function call scheduling with native audio models?
As of March 2026. Please link to official Google AI documentation, model cards, or release notes.

Here’s what Google’s own docs say as of March 2026.

## Stable native audio models and platforms

For the Live API, the key Gemini native audio model in **GA (non‑preview)** is:

- `gemini-live-2.5-flash-native-audio`
    - Listed as **Launch stage: GA** with release date Dec 12, 2025 and a discontinuation date in Dec 2026 in the Gemini 2.5 Flash Live API model page for Vertex AI.[^1]
    - That page explicitly categorizes it as a **“Gemini 2.5 Flash with Gemini Live API”** native audio model and shows it as the GA successor to the earlier preview model `gemini-live-2.5-flash-preview-native-audio-09-2025`.[^1]

Platform support:

- **Vertex AI (Google Cloud)**
    - The Gemini 2.5 Flash Live API model page is under the Vertex AI docs and describes deployments and endpoints specifically for Vertex AI.[^2][^1]
    - A Google Cloud blog post “How to use Gemini Live API Native Audio in Vertex AI” walks through using Gemini 2.5 Flash Native Audio with the Live API on Vertex AI, confirming GA availability there.[^3]
- **Google AI Studio / Gemini API (direct API key)**
    - The Gemini audio update announcement states that “Gemini 2.5 Flash Native Audio is now available across Google products including Google AI Studio, Vertex AI” (and also Gemini Live and Search Live).[^4]
    - The general Gemini Live API overview on ai.google.dev describes using the Live API with Gemini models via the Gemini API (which is what AI Studio fronts), and the tools documentation uses `gemini-2.5-flash-native-audio-preview-12-2025` and similar names as examples of Live‑capable native audio models on the Gemini API backend.[^5][^6][^7]

So, in stable (non‑preview) form, **Gemini 2.5 Flash Native Audio is GA on both Vertex AI and Google AI Studio / Gemini API**, though the **exact model ID string used in examples is often the preview variant in older docs, while the model card shows the GA `gemini-live-2.5-flash-native-audio` variant.**[^4][^1]

## Is `gemini-live-2.5-flash-native-audio` AI Studio or Vertex‑only?

- The Vertex AI model card explicitly lists `gemini-live-2.5-flash-native-audio` as a Live‑API‑compatible model with GA launch stage.[^1]
- The Google AI Studio / Gemini API docs and Firebase AI Logic docs tend to reference `gemini-2.5-flash-native-audio-preview-12-2025` in code snippets, but the December 2025 Gemini audio update explicitly says the updated Gemini 2.5 Flash Native Audio is **available in Google AI Studio and Vertex AI**, not just Vertex AI.[^8][^6][^4]

Putting that together:

- **Functionally, the same Gemini 2.5 Flash Native Audio model family is available via both Vertex AI and Google AI Studio.**[^4]
- **The exact model ID `gemini-live-2.5-flash-native-audio` is formally documented under the Vertex AI model card; AI Studio’s public examples still often show the preview‐style IDs, but the product blog and Live API docs indicate that the GA native audio model is exposed via the Gemini API (AI Studio) as well.**[^7][^1][^4]

If you need to be 100% sure of the exact model name string for AI Studio in your region, the safest operational check is to call the Gemini API “list models” endpoint from your AI Studio API key and verify the returned IDs, since the docs lag behind the rollout.

## NON_BLOCKING function calling with native audio

- The **tool use / function calling guide for the Live API on ai.google.dev** shows using tools with a native audio model (`model = "gemini-2.5-flash-native-audio-preview-12-2025"`) via the Gemini API client.[^7]
    - The example demonstrates:
        - Attaching `tools` (function declarations) in `config`.
        - Receiving `response.tool_call` events while audio is streaming.
        - Sending `session.send_tool_response(function_responses=...)` back asynchronously, while continuing to receive and write audio frames (to `audio.wav`).[^7]
    - That pattern is explicitly described as the way the Live API “lets the model schedule tool calls while continuing to stream responses,” which is the non‑blocking behavior you are asking about.[^7]
- The Firebase AI Logic Live API docs (which use the **Google AI backend**, i.e., the same Gemini API as AI Studio) show native audio models used with tools and continuous audio streaming, reinforcing that **live sessions can both stream audio and perform tool use without blocking the audio stream.**[^9][^6]

So:

- **Yes, Google AI Studio’s Live API (Gemini API) supports non‑blocking function call scheduling with native audio models.**
- You can attach tools when you open the live session, receive tool call events while audio is streaming, execute your own functions, and send tool responses back while the model continues audio output, matching the behavior you are used to on Vertex Live/BidiGenerateContent.[^6][^7]


### Model list snapshot (relevant to your migration)

From the Vertex AI Gemini 2.5 Flash Live model page:[^1]


| Model ID | Stage | Notes |
| :-- | :-- | :-- |
| `gemini-live-2.5-flash-native-audio` | GA | Stable native audio Live API model |
| `gemini-live-2.5-flash-preview-native-audio-09-2025` | Public preview | Older preview, EOL March 19, 2026 |

Google’s December 2025 audio update confirms the updated **Gemini 2.5 Flash Native Audio** is available in both **Google AI Studio (Gemini API)** and **Vertex AI**, and is the recommended model for real‑time voice agents.[^4]

If you share your current region or environment (Cloud vs. direct Gemini API key only), I can suggest a concrete migration path and example connection code that preserves non‑blocking tool behavior.
<span style="display:none">[^10][^11][^12][^13][^14][^15]</span>

<div align="center">⁂</div>

[^1]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api

[^2]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api

[^3]: https://cloud.google.com/blog/topics/developers-practitioners/how-to-use-gemini-live-api-native-audio-in-vertex-ai

[^4]: https://blog.google/products-and-platforms/products/gemini/gemini-audio-model-updates/

[^5]: https://ai.google.dev/gemini-api/docs/live-api

[^6]: https://firebase.google.com/docs/ai-logic/live-api

[^7]: https://ai.google.dev/gemini-api/docs/live-tools

[^8]: https://developer.android.com/ai/gemini/live

[^9]: https://firebase.google.com/docs/ai-logic/live-api/capabilities

[^10]: https://gist.github.com/hayesraffle/ab09fc7d21a5df3a01b0f69fb353280c

[^11]: https://discuss.ai.google.dev/t/gemini-live-audio-regression-post-march-9-2026-update/130605

[^12]: https://aistudio.google.com

[^13]: https://ai.google.dev/gemini-api/docs/available-regions

[^14]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash

[^15]: https://www.reddit.com/r/singularity/comments/1pl3cce/google_deepmind_gemini_rolling_out_an_updated/

