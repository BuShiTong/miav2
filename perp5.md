<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# We're building a real-time voice app using Google's Gemini Live API (BidiGenerateContent) with the google-genai Python SDK. We currently use the model ID gemini-2.5-flash-native-audio-latest.

What Gemini native audio models are currently available for the Live API? List all model IDs, including any "Dialogue" variants that appear in Google AI Studio. What's the difference between them?
Which of these models are preview vs. generally available, and which does Google recommend for real-time voice applications?
Are there any newer native audio models released after Gemini 2.5 Flash Native Audio?
I care about: correct model IDs for the Python SDK, stability/GA status, and audio quality for conversational use cases.
As of March 2026. Please include links to official Google AI documentation.

As of March 2026, the only generally available Gemini “native audio” model for the public Gemini Live API is the Gemini 2.5 Flash Native Audio line, with a few newer preview variants (including new “dialog” models) layered on top.[^1][^2][^3]

## Current native audio model IDs (Live API / BidiGenerateContent)

For the Google AI “Gemini API” (what the google‑genai Python SDK uses), the native audio models you can use with `BidiGenerateContent` are:

- `gemini-2.5-flash-native-audio-preview-12-2025` (main Live native audio model, preview)[^3][^1]
- `gemini-2.5-flash-preview-native-audio-dialog` (dialog‑tuned native audio, preview)[^2]
- `gemini-2.5-flash-exp-native-audio-thinking-dialog` (dialog‑tuned with thinking tokens, experimental preview)[^2]

Google’s docs and release notes explicitly mention these model IDs for the Live API; there is no newer “3.x” or separate “2.5 Pro Native Audio” Live model as of March 2026.[^3][^2]

On Vertex AI (if you ever use that), the same core model appears as:

- `gemini-live-2.5-flash-native-audio` (Vertex AI Gemini API Live native audio model)[^1]

Google also notes that older “gemini‑live‑2.5‑flash‑preview” names that circulated in early forums are not valid for current v1beta BidiGenerateContent calls.[^4]

## “Dialogue” vs. base native audio

The difference is task‑tuning and capabilities rather than a completely different base model:

- **Base native audio (`gemini-2.5-flash-native-audio-preview-12-2025`)**
    - General‑purpose Live audio model for low‑latency voice and video interaction.[^5][^1][^3]
    - Handles continuous listening, speech understanding, and speech generation across 24+ languages and 30+ HD voices.[^6][^7][^1]
    - Focused on real‑time agents, live translation, and multimodal control rather than purely “assistant chat” tone.[^8][^7][^5]
- **Dialog models (`…-native-audio-dialog`)**
    - Announced as new “Gemini models for the Live API with native audio output capabilities” specifically for conversation.[^9][^2]
    - “Gemini 2.5 Flash native audio dialog” is marketed as generating more natural sounding voices for conversation, with multiple distinct voices and better prosody/turn‑taking.[^9]
    - The `…-thinking-dialog` variant exposes the Live API “thinking” stream, adding explicit reasoning tokens so you can trade off latency vs. quality and inspect the chain‑of‑thought style intermediate output (when enabled).[^2][^3]

In practice for a real‑time voice app:

- Use `gemini-2.5-flash-native-audio-preview-12-2025` for fastest and most stable behavior across a wide range of tasks.[^5][^1][^3]
- Try `gemini-2.5-flash-preview-native-audio-dialog` if you want more conversational, “assistant‑like” voice and are comfortable with preview‑tier changes.[^9][^2]
- Use `gemini-2.5-flash-exp-native-audio-thinking-dialog` only if you need the thinking stream for research/debugging; it is experimental, may be slower, and is more likely to change.[^3][^2]


## Preview vs. GA and recommended models

Google’s public docs currently classify the Gemini 2.5 Flash Native Audio line as “preview” for the Gemini Developer API, even though it’s widely available, while Vertex AI presents the same core model as production‑ready with the standard model lifecycle guidance.[^10][^1][^5]

- **Preview / experimental in Gemini API**
    - `gemini-2.5-flash-native-audio-preview-12-2025` (explicitly labeled “preview” in docs and code samples).[^1][^3]
    - `gemini-2.5-flash-preview-native-audio-dialog` (release notes announce this as a new Live API model, implied preview).[^2]
    - `gemini-2.5-flash-exp-native-audio-thinking-dialog` (explicitly “exp”, i.e., experimental preview).[^2]
- **Generally available / production‑intended**
    - On Vertex AI, `gemini-live-2.5-flash-native-audio` is the production Live native audio model, documented in how‑to guides and with standard SLO/lifecycle language.[^6][^10][^5]

**Google’s recommendation for real‑time voice** (from docs and product pages):

- Use Gemini 2.5 Flash Native Audio as the default for live voice agents and real‑time customer support/chatbots.[^7][^8][^5]
- For the public Gemini API and the google‑genai SDK, sample code shows `gemini-2.5-flash-native-audio-preview-12-2025` as the recommended Live model string for `ai.live.connect` / `BidiGenerateContent`.[^3]
- Dialog/thinking variants are called out as new options rather than replacements, so they are for improved conversational feel and experimentation, not yet the “default” stable choice.[^9][^2]

Given your priorities (audio quality + stability):

- For production: keep `gemini-2.5-flash-native-audio-preview-12-2025` (or the non‑preview Vertex AI equivalent) as your primary model.[^5][^1][^3]
- For AB tests: try `gemini-2.5-flash-preview-native-audio-dialog` for richer conversational prosody and possibly better turn‑taking.[^9][^2]
- Avoid basing SLAs on `…-exp-native-audio-thinking-dialog`; treat it as experimental.[^2]


## Any newer native audio models after 2.5 Flash Native Audio?

As of the latest Gemini API release notes (updated March 10, 2026), there are **no newer core “native audio” generations beyond the 2.5 Flash Native Audio family** for the Live API.[^2]

The most recent additions affecting real‑time audio are:

- The two dialog Live models:
    - `gemini-2.5-flash-preview-native-audio-dialog`
    - `gemini-2.5-flash-exp-native-audio-thinking-dialog`[^2]
- A separate **Lyria** music model (`lyria-realtime-exp`) for real‑time music generation, which is not a general conversational voice model.[^2]

Google’s December 2025 Gemini Audio blog and the Vertex AI Live Native Audio how‑to emphasize that the updated Gemini 2.5 Flash Native Audio model is what powers “the next generation of live voice agents,” but they do not introduce a newer “3.x” Live model.[^8][^7][^5]

## SDK model strings and doc links

For the google‑genai Python SDK with Live/BidiGenerateContent:

- Use one of these `model=` values:
    - `gemini-2.5-flash-native-audio-preview-12-2025` (recommended default).[^1][^3]
    - `gemini-2.5-flash-preview-native-audio-dialog` (conversational dialog, preview).[^2]
    - `gemini-2.5-flash-exp-native-audio-thinking-dialog` (dialog + thinking stream, experimental).[^2]

Key official docs and references:

- Gemini Live API (WebSockets / BidiGenerateContent) reference:
https://ai.google.dev/api/live[^11]
- Live API capabilities guide (includes Python and JS examples using `gemini-2.5-flash-native-audio-preview-12-2025`):
https://ai.google.dev/gemini-api/docs/live-guide[^3]
- Gemini 2.5 Flash with Live API native audio overview (Vertex AI):
https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api[^6]
- Firebase AI Logic “supported models” (shows Dev API vs Vertex model IDs for Gemini 2.5 Flash Native Audio):
https://firebase.google.com/docs/ai-logic/models[^1]
- Vertex AI blog: “How to use Gemini Live API Native Audio in Vertex AI”:
https://cloud.google.com/blog/topics/developers-practitioners/how-to-use-gemini-live-api-native-audio-in-vertex-ai[^5]
- Gemini API release notes (model launches, including dialog \& thinking dialog):
https://ai.google.dev/gemini-api/docs/changelog[^2]
- “Gemini Audio” overview page:
https://deepmind.google/models/gemini-audio/[^8]
- “Improved Gemini audio models for powerful voice interactions” blog (Dec 2025 update):
https://blog.google/products-and-platforms/products/gemini/gemini-audio-model-updates/[^7]

Would it help if I propose a concrete model migration plan (e.g., base vs dialog vs thinking-dialog) for your production vs. staging environments with suggested timeouts and audio settings?
<span style="display:none">[^12][^13][^14][^15]</span>

<div align="center">⁂</div>

[^1]: https://firebase.google.com/docs/ai-logic/models

[^2]: https://ai.google.dev/gemini-api/docs/changelog

[^3]: https://ai.google.dev/gemini-api/docs/live-guide

[^4]: https://discuss.ai.google.dev/t/gemini-2-5-flash-native-audio-preview-09-2025-text-text-only-not-working/107467?page=2

[^5]: https://cloud.google.com/blog/topics/developers-practitioners/how-to-use-gemini-live-api-native-audio-in-vertex-ai

[^6]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api

[^7]: https://blog.google/products-and-platforms/products/gemini/gemini-audio-model-updates/

[^8]: https://deepmind.google/models/gemini-audio/

[^9]: https://developers.googleblog.com/gemini-api-io-updates/

[^10]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions

[^11]: https://ai.google.dev/api/live

[^12]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api

[^13]: https://en.wikipedia.org/wiki/Gemini_(language_model)

[^14]: https://discuss.ai.google.dev/t/generatecontent-api-and-bidigeneratecontent-api-on-supported-on-gemini-2-0-flash-exp/113667

[^15]: https://discuss.ai.google.dev/t/gemini-live-api-gemini-2-5-flash-native-audio-preview-12-2025/119862

