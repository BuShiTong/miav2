<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# I'm building a voice cooking assistant using Gemini Live API with gemini-live-2.5-flash-native-audio on Vertex AI. Sessions can run 30-60 minutes with continuous audio.

What is the token accumulation rate for audio input (16kHz PCM) and for video/image frames in Gemini Live API sessions? How many tokens per second of audio, and how many tokens per image frame?
Without context_window_compression enabled, what is the maximum session duration for audio-only and audio+video Live API sessions before the context window fills up?
I care about: concrete numbers (tokens per second, max minutes), not general descriptions.
As of March 2026. Please include links to official Google docs or API reference pages.

Here is what Google’s docs say today, plus the implied upper bounds for gemini-live-2.5-flash-native-audio sessions.

## Tokenization rates (audio, video, images)

**Audio (Gemini Live native audio)**

- Vertex’s Live API best-practices explicitly warns that *“native audio tokens accumulate rapidly (approximately 25 tokens per sec of audio)”* for Live sessions.[^1]
- This is specifically about the Live API’s native audio mode (your model), not offline file inference.

**Audio (generic Gemini audio files, non‑Live)**

- The Gemini “Understand and count tokens” doc says that *audio files* are converted at a fixed rate of **32 tokens per second**.[^2]
- This is useful as an upper-bound sanity check, but for Live native audio you should primarily rely on the ~25 tokens/sec figure above.[^3][^1]

**Video**

- The same token-counting doc states: *“Video and audio files are converted to tokens at the following fixed rates: video at 263 tokens per second and audio at 32 tokens per second.”*[^2]
- For continuous video in a Live session, you should assume **≈263 tokens per second of video** are added to the context, before any audio or text.

**Images / video frames**

- Gemini’s image-understanding docs give the base rule: each image with both dimensions ≤384 px is **258 tokens**; larger images are tiled into 768×768 tiles, **each tile costing 258 tokens**.[^4]
- The docs also note that media resolution controls the *maximum tokens per image or video frame*; but for Gemini 2.x/2.5, the default tiling rule above applies.[^4][^2]
- The Live API overview limits image streaming to **JPEG at ≤1 FPS**, so at 1 frame per second a small-enough frame is roughly **≈258 tokens/sec** (more if high‑res tiles are used).[^5][^4]

So, in practice for Gemini Live 2.5 Flash native audio:

- Audio (16 kHz PCM): **≈25 tokens/sec** (Live native audio).[^1]
- Video stream: **≈263 tokens/sec**.[^2]
- 1 FPS image frames (≤384×384 each): **≈258 tokens/sec**.[^5][^4]


## Context window and limits for gemini-live-2.5-flash-native-audio

From the Vertex AI model reference for **gemini-live-2.5-flash-native-audio**:[^6]

- **Maximum input tokens:** 128K.[^6]
- **Maximum output tokens:** 64K.[^6]
- **Max context size (parameter default):** 128K.[^6]
- **Audio spec:** “Maximum conversation length: Default 10 minutes that can be extended.”[^6]

For the **preview** version (`gemini-live-2.5-flash-preview-native-audio-09-2025`), the same page clarifies that the **context window is 32K by default, upgradable to 128K**.[^6]

Separately, the Live WebSocket reference describes `ContextWindowCompressionConfig` and notes that the default `triggerTokens` is **80% of the model’s context window**, but that only applies if you enable compression. Since you asked **“without context_window_compression”**, we’ll use the **full 128K-token context** as the hard ceiling.[^7]

## Max duration: audio‑only Live session (no compression)

Assuming:

- Model: `gemini-live-2.5-flash-native-audio` on Vertex AI.[^6]
- Context window: 128K tokens (max context size).[^6]
- Audio tokenization: ≈25 tokens/sec native audio in Live.[^1]
- Ignoring, for an upper bound, system prompt + text turns + output tokens (in reality these will eat some fraction of the window).

Then:

- **Time until 128K context is saturated by audio alone**
    - 128,000 tokens ÷ 25 tokens/sec ≈ **5,120 seconds ≈ 85 minutes**.

Given that:

- 30 minutes of continuous audio: 25 × 1,800 ≈ **45K tokens** → ~35% of 128K.
- 60 minutes of continuous audio: 25 × 3,600 ≈ **90K tokens** → ~70% of 128K.

So, **for audio-only Live sessions, 30–60 minutes of continuous 16 kHz PCM is well within the 128K context limit**, as long as you don’t also pack in a huge amount of additional text/tools or extremely verbose model outputs.[^1][^6]

If you instead used the more conservative generic audio rate of 32 tokens/sec from the token-count doc, you would get:

- 128,000 ÷ 32 ≈ **4,000 seconds ≈ 66 minutes**.[^2]

That still leaves a 60‑minute session plausible, but with less headroom. For production, I’d budget using **32 tokens/sec as a safety bound** even though Live best‑practices say ≈25/sec.

## Max duration: audio + video / image Live sessions (no compression)

Here we combine the documented token rates.

### Audio + continuous video (file-like)

Using the token-count doc’s rates for video (263 t/s) and generic audio (32 t/s) as an upper bound:[^2]

- Combined token rate ≈ 263 + 32 = **295 tokens/sec**.
- Max duration from 128K context: 128,000 ÷ 295 ≈ **434 seconds ≈ 7.2 minutes**.

If you instead assume Live native audio ≈25 t/s with the same 263 t/s for video:[^1][^2]

- Combined ≈ 263 + 25 = **288 tokens/sec**.
- 128,000 ÷ 288 ≈ **444 seconds ≈ 7.4 minutes**.

So, **audio + continuous video will fill a 128K context in roughly 7–8 minutes without compression**, even before counting text/tool calls.[^2][^6]

### Audio + 1 FPS JPEG frames (camera snapshots)

The Live overview constrains image input to JPEG at ≤1 FPS. For per-frame tokens we use the image-understanding rules:[^5][^4]

- Small frame (≤384×384): 258 tokens/frame → at 1 FPS ≈ **258 tokens/sec**.[^4]
- Live audio: ≈25 tokens/sec.[^1]
- Combined ≈ 258 + 25 = **283 tokens/sec**.

Then:

- 128,000 ÷ 283 ≈ **≈450 seconds ≈ 7.5 minutes**.

If your frames are larger and tile into multiple 768×768 tiles, multiply 258 tokens by the tile count; for example, 2 tiles per frame at 1 FPS would be ≈516 tokens/sec just for images, cutting the max duration roughly in half.[^4]

### Summary table (idealized upper bounds)

Assuming the full 128K context is used almost entirely for media tokens:


| Scenario | Token rate (approx.) | Time to 128K tokens (sec) | Time to 128K tokens (min) |
| :-- | :-- | :-- | :-- |
| Audio‑only (Live native audio) | 25 tokens/sec[^1] | ≈5,120 | ≈85 |
| Audio‑only (generic audio rate) | 32 tokens/sec[^2] | ≈4,000 | ≈66 |
| Video‑only | 263 tokens/sec[^2] | ≈487 | ≈8.1 |
| Audio + video | 288–295 tokens/sec[^1][^2] | ≈434–444 | ≈7.2–7.4 |
| Audio + 1 FPS small JPEG | ≈283 tokens/sec[^1][^5][^4] | ≈450 | ≈7.5 |

In a **real** Live session you must also budget for:

- System instructions and any persistent tool state.
- Text turns from the user (e.g., corrections, typed input).
- The model’s own text and audio output tokens.

Those will reduce the effective max durations somewhat, especially in multimodal sessions.

## Practical guidance for a 30–60 minute cooking assistant

- For **audio‑only cooking sessions**, 30–60 minutes of continuous speech is comfortably within the 128K context window for `gemini-live-2.5-flash-native-audio`, even using conservative 32 tokens/sec audio assumptions.[^1][^2][^6]
- For **audio + continuous video or 1 FPS frames**, you will hit the context window in **~7–8 minutes** unless you either:
    - Turn on `ContextWindowCompressionConfig` and let the server summarize, or
    - Periodically summarize-and-reset on your side (e.g., send a text summary and start a new Live session with that summary as context).

Key docs you may want to bookmark:

- Gemini Live API best practices (includes ~25 tokens/sec native audio note):
https://cloud.google.com/vertex-ai/generative-ai/docs/live-api/best-practices[^1]
- Gemini 2.5 Flash with Gemini Live API native audio (model limits, 128K context):
https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api[^6]
- Gemini Live API overview (modalities, 1 FPS JPEG):
https://ai.google.dev/gemini-api/docs/live-api[^5]
- Token counting (audio/video rates) and image tokenization:
https://ai.google.dev/gemini-api/docs/tokens[^2]
https://ai.google.dev/gemini-api/docs/image-understanding[^4]

If you tell me your exact plan for video (FPS, resolution), I can work out a more precise token budget and a strategy for when to compress or summarize.
<span style="display:none">[^10][^11][^12][^13][^14][^15][^16][^17][^18][^19][^20][^21][^22][^23][^24][^25][^26][^27][^28][^29][^30][^31][^32][^33][^34][^35][^36][^37][^38][^39][^40][^41][^42][^43][^44][^45][^46][^47][^48][^49][^50][^51][^8][^9]</span>

<div align="center">⁂</div>

[^1]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/best-practices

[^2]: https://ai.google.dev/gemini-api/docs/tokens

[^3]: https://www.scribd.com/document/969899503/Gemini-Live-API-Cookbook-1765940819

[^4]: https://ai.google.dev/gemini-api/docs/image-understanding

[^5]: https://ai.google.dev/gemini-api/docs/live-api

[^6]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api

[^7]: https://ai.google.dev/api/live

[^8]: https://arxiv.org/pdf/2504.04949.pdf

[^9]: http://arxiv.org/pdf/2409.14085.pdf

[^10]: https://arxiv.org/pdf/2503.11315.pdf

[^11]: https://arxiv.org/pdf/2309.10922.pdf

[^12]: https://arxiv.org/pdf/2306.05284.pdf

[^13]: https://arxiv.org/html/2503.22275

[^14]: https://arxiv.org/pdf/2406.05551.pdf

[^15]: http://arxiv.org/pdf/2403.05530.pdf

[^16]: https://ai.google.dev/gemini-api/docs/live-api/capabilities

[^17]: https://firebase.google.com/docs/ai-logic/live-api/limits-and-specs

[^18]: https://lablab.ai/ai-tutorials/building-voice-agents-gemini-live-fastapi

[^19]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-live

[^20]: https://ai.google.dev/gemini-api/docs/live-api/capabilities?hl=es-419

[^21]: https://cloud.google.com/blog/topics/developers-practitioners/how-to-use-gemini-live-api-native-audio-in-vertex-ai

[^22]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash

[^23]: https://github.com/AnelMusic/google-gemini-live-api-multimodal-demo

[^24]: https://www.linkedin.com/posts/chamikakasun_how-to-use-gemini-live-api-native-audio-in-activity-7405372094214995968-XMam

[^25]: https://openrouter.ai/google/gemini-2.5-flash

[^26]: https://dev.to/combba/making-go-speak-real-time-our-gemini-live-api-websocket-proxy-41of

[^27]: https://ieeexplore.ieee.org/document/10768970/

[^28]: https://www.semanticscholar.org/paper/966020401e224deb5d7ec953897760254046ef5a

[^29]: https://arxiv.org/abs/2512.17519

[^30]: https://ieeexplore.ieee.org/document/11393748/

[^31]: https://link.springer.com/10.3758/s13428-020-01352-0

[^32]: https://journal.stiemb.ac.id/index.php/mea/article/view/3869

[^33]: https://dl.acm.org/doi/10.1145/3696789

[^34]: https://www.isca-archive.org/interspeech_2005/mixdorff05_interspeech.html

[^35]: https://www.semanticscholar.org/paper/d4d71ee830dbc99bd330c4d267c6bce3ec012331

[^36]: https://www.semanticscholar.org/paper/56b3fa7f6a2cab5dc739eca72314e97d2e15d8e1

[^37]: https://arxiv.org/html/2408.16532

[^38]: https://arxiv.org/pdf/2404.02781.pdf

[^39]: https://arxiv.org/pdf/2406.14294.pdf

[^40]: http://arxiv.org/pdf/2410.08325.pdf

[^41]: http://arxiv.org/pdf/2310.04673.pdf

[^42]: https://www.reddit.com/r/Bard/comments/1ljhkz7/confused_about_image_tokens_my_2555x1630_image/

[^43]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-understanding

[^44]: https://github.com/google/adk-python/issues/2175

[^45]: https://www.facebook.com/groups/vibecodinglife/posts/1918825438705984/

[^46]: https://docs.rs/rust-genai-types/latest/rust_genai_types/live_types/index.html

[^47]: https://developers.googleblog.com/introducing-gemini-2-5-flash-image/

[^48]: https://www.reddit.com/r/Bard/comments/1iy8ni1/finally/

[^49]: https://cloud.google.com/vertex-ai/generative-ai/pricing

[^50]: https://en.namu.wiki/w/Gemini 3.0

[^51]: https://firebase.google.com/docs/ai-logic/generate-images-imagen

