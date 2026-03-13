import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "../lib/logger";

const log = createLogger("AudioPlayback");

/** Decode base64 PCM16 audio to Float32 samples for the playback worklet. */
function base64Pcm16ToFloat32(base64: string): Float32Array {
  // Gemini sends URL-safe base64 (- and _). Convert to standard base64 (+ and /).
  const standard = base64.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(standard);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

export function useAudioPlayback() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const playCountRef = useRef(0);
  const isMutedRef = useRef(false);
  const lastPlayTimestampRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resume AudioContext when tab becomes visible again (browsers suspend it on tab switch)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && audioContextRef.current) {
        const state = audioContextRef.current.state;
        if (state === "suspended") {
          audioContextRef.current.resume().then(() => {
            log.info("Playback AudioContext resumed after tab switch");
          }).catch((err) => {
            log.warn("Playback AudioContext resume failed", err);
          });
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const start = useCallback(async () => {
    const audioContext = new AudioContext({ sampleRate: 24000 });
    audioContextRef.current = audioContext;
    log.info("Playback AudioContext created", {
      sampleRate: audioContext.sampleRate,
      state: audioContext.state,
    });
    if (audioContext.sampleRate !== 24000) {
      log.error("Playback sample rate mismatch", {
        expected: 24000,
        actual: audioContext.sampleRate,
      });
    }

    // Cache-bust worklet URL to prevent stale cached versions
    await Promise.race([
      audioContext.audioWorklet.addModule("/playback-processor.js?v=" + Date.now()),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Audio setup took too long. Try reloading the page.")), 8000),
      ),
    ]);
    log.info("Playback worklet loaded");

    const workletNode = new AudioWorkletNode(
      audioContext,
      "playback-processor",
    );
    workletNodeRef.current = workletNode;
    playCountRef.current = 0;

    workletNode.port.onmessage = (event: MessageEvent) => {
      if (event.data?.type === "diag") {
        log.debug("worklet metrics", event.data);
      }
      if (event.data?.type === "playback_active") {
        lastPlayTimestampRef.current = Date.now();
        setIsPlaying(true);
        if (isPlayingTimeoutRef.current) clearTimeout(isPlayingTimeoutRef.current);
        isPlayingTimeoutRef.current = setTimeout(() => setIsPlaying(false), 500);
      }
    };

    // AnalyserNode for audio visualization (passive — does not modify signal)
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.7;
    analyserRef.current = analyser;

    // GainNode for barge-in fade-out (worklet → analyser → gain → speakers)
    const gainNode = audioContext.createGain();
    gainNodeRef.current = gainNode;
    workletNode.connect(analyser);
    analyser.connect(gainNode);
    gainNode.connect(audioContext.destination);
  }, []);

  const playAudio = useCallback((base64Pcm16: string) => {
    if (!workletNodeRef.current) {
      log.warn("Dropping audio — playback worklet not ready");
      return;
    }

    // After barge-in flush, unmute on the first audio chunk that arrives.
    // The backend gate ensures old-response audio was dropped, so this chunk
    // is from the new response (or at worst a single stale chunk).
    if (isMutedRef.current) {
      if (gainNodeRef.current && audioContextRef.current) {
        gainNodeRef.current.gain.setValueAtTime(1, audioContextRef.current.currentTime);
        isMutedRef.current = false;
        log.info("Unmuted (new audio after barge-in)");
      }
    }

    lastPlayTimestampRef.current = Date.now();
    setIsPlaying(true);
    if (isPlayingTimeoutRef.current) clearTimeout(isPlayingTimeoutRef.current);
    isPlayingTimeoutRef.current = setTimeout(() => setIsPlaying(false), 500);
    playCountRef.current++;
    const float32 = base64Pcm16ToFloat32(base64Pcm16);
    workletNodeRef.current.port.postMessage(float32);

    if (playCountRef.current % 50 === 0) {
      log.debug(`chunks sent to worklet: ${playCountRef.current}, latest: ${float32.length} samples`);
    }
  }, []);

  const flushAudio = useCallback(() => {
    const audioContext = audioContextRef.current;
    const gainNode = gainNodeRef.current;
    const workletNode = workletNodeRef.current;
    if (!audioContext || !gainNode || !workletNode) return;

    log.info("Flushing audio (barge-in)");

    // Instant mute — user's voice masks any artifact during barge-in
    gainNode.gain.cancelScheduledValues(audioContext.currentTime);
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);

    // Immediately clear the worklet queue (no setTimeout = no race condition)
    workletNode.port.postMessage("flush");

    isMutedRef.current = true;
    setIsPlaying(false);
    if (isPlayingTimeoutRef.current) clearTimeout(isPlayingTimeoutRef.current);
  }, []);

  const stop = useCallback(() => {
    log.info("Audio playback stopped", {
      totalChunksPlayed: playCountRef.current,
    });

    setIsPlaying(false);
    if (isPlayingTimeoutRef.current) clearTimeout(isPlayingTimeoutRef.current);

    // Smooth 20ms gain ramp to zero — prevents click/pop on stop
    const ctx = audioContextRef.current;
    const gain = gainNodeRef.current;
    if (ctx && gain && ctx.state !== "closed") {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.02);
    }

    // Disconnect and close after ramp completes (50ms > 20ms ramp for safety margin)
    setTimeout(() => {
      workletNodeRef.current?.disconnect();
      workletNodeRef.current = null;

      analyserRef.current?.disconnect();
      analyserRef.current = null;

      gainNodeRef.current?.disconnect();
      gainNodeRef.current = null;

      audioContextRef.current?.close();
      audioContextRef.current = null;
    }, 50);
  }, []);

  return { start, playAudio, flushAudio, stop, lastPlayTimestampRef, isPlaying, analyserRef };
}
