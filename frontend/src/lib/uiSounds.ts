/**
 * Subtle UI feedback sounds using AudioContext oscillators.
 * No audio files needed — generates tones programmatically.
 */

// Minimal silent WAV (100ms, 1-ch, 8 kHz, 16-bit PCM) as a data URL.
// Used to "claim" the media audio channel on mobile so volume buttons
// control media (Mia's voice) instead of ringtone/notification volume.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YQAAAAA=";

/** Play a silent clip via <audio> to activate the media volume channel on mobile. */
export function claimMediaChannel(): void {
  try {
    const el = document.createElement("audio");
    el.src = SILENT_WAV;
    el.volume = 0.01;
    el.addEventListener("ended", () => el.remove(), { once: true });
    el.play().catch(() => {});
  } catch {
    // Silent fail — non-critical
  }
}

let ctx: AudioContext | null = null;

function getContext(): AudioContext {
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioContext();
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }
  return ctx;
}

/** Warm ascending two-tone — confirms audio pipeline works. */
export function playConnectSound(): void {
  try {
    const ac = getContext();
    const gain = ac.createGain();
    gain.connect(ac.destination);

    const now = ac.currentTime;
    // Two ascending tones: C5 → E5 (warm major third)
    const osc1 = ac.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = 523; // C5
    osc1.connect(gain);

    const osc2 = ac.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = 659; // E5
    osc2.connect(gain);

    // First tone
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + 0.15);
    osc1.start(now);
    osc1.stop(now + 0.15);

    // Second tone (slightly louder, confirms it's intentional)
    gain.gain.linearRampToValueAtTime(0.1, now + 0.17);
    gain.gain.linearRampToValueAtTime(0, now + 0.35);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.35);
  } catch {
    // Silent fail — sound is non-critical
  }
}

/** Short confirmation chirp — timer acknowledged. */
export function playTimerSetSound(): void {
  try {
    const ac = getContext();
    const gain = ac.createGain();
    gain.connect(ac.destination);

    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 784; // G5
    osc.connect(gain);

    const now = ac.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.07, now + 0.01);
    gain.gain.linearRampToValueAtTime(0, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.12);
  } catch {
    // Silent fail
  }
}

export function closeSoundContext(): void {
  if (ctx && ctx.state !== "closed") {
    ctx.close().catch(() => {});
    ctx = null;
  }
}
