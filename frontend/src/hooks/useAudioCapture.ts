import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import { createLogger } from "../lib/logger";

const log = createLogger("AudioCapture");

// Speech detection constants
// Capture worklet sends 640-sample chunks (~40ms at 16kHz), ~25 chunks/sec.
// Frame timing constants are calibrated for this chunk size.
const MIN_RMS_THRESHOLD = 0.015; // Absolute floor — calibrated for echoCancellation:false (see problems-solved.md #7)
const BARGE_IN_MULTIPLIER = 3.0; // Speech must be 3x louder than echo baseline
const BASELINE_ALPHA = 0.02; // EMA smoothing — preserves ~2s time constant at 25 chunks/sec (was 0.05 at 10/sec)
const SPEECH_FRAMES_REQUIRED = 3; // ~120ms sustained speech before triggering (3 × 40ms)
const SILENCE_FRAMES_REQUIRED = 5; // ~200ms silence before allowing re-trigger (5 × 40ms)
const AI_PLAYING_WINDOW_MS = 500; // AI "playing" if heartbeat/audio arrived within this window

/** Convert Float32 [-1, 1] samples to Int16 PCM bytes, then base64. */
function float32ToBase64Pcm16(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = float32[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

interface UseAudioCaptureOptions {
  onAudioChunk: (base64Pcm16: string) => void;
  onSpeechStart?: () => void;
  lastPlayTimestampRef?: MutableRefObject<number>;
}

export function useAudioCapture({
  onAudioChunk,
  onSpeechStart,
  lastPlayTimestampRef,
}: UseAudioCaptureOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const chunkCountRef = useRef(0);

  // Speech detection state
  const speechFrameCountRef = useRef(0);
  const silenceFrameCountRef = useRef(0);
  const speechTriggeredRef = useRef(false);
  const echoBaselineRef = useRef(0);
  const peakRmsRef = useRef(0);
  const micRmsRef = useRef(0);

  // Resume AudioContext when tab becomes visible again (browsers suspend it on tab switch)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && audioContextRef.current) {
        const state = audioContextRef.current.state;
        if (state === "suspended") {
          audioContextRef.current.resume().then(() => {
            log.info("Capture AudioContext resumed after tab switch");
          }).catch((err) => {
            log.warn("Capture AudioContext resume failed", err);
          });
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const start = useCallback(async (): Promise<"granted" | "denied"> => {
    try {
      log.info("Requesting microphone access");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings();
      log.info("Microphone granted", {
        sampleRate: settings.sampleRate,
        channelCount: settings.channelCount,
        deviceId: settings.deviceId,
      });

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      log.info("AudioContext created", {
        sampleRate: audioContext.sampleRate,
        state: audioContext.state,
      });
      if (audioContext.sampleRate !== 16000) {
        log.error("Capture sample rate mismatch", {
          expected: 16000,
          actual: audioContext.sampleRate,
        });
      }

      await Promise.race([
        audioContext.audioWorklet.addModule("/capture-processor.js"),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Audio setup took too long. Try reloading the page.")), 8000),
        ),
      ]);
      log.info("Capture worklet loaded");

      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(
        audioContext,
        "capture-processor",
      );
      workletNodeRef.current = workletNode;
      chunkCountRef.current = 0;

      workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        chunkCountRef.current++;
        const samples = event.data;
        const base64 = float32ToBase64Pcm16(samples);
        onAudioChunk(base64);

        // Speech detection — only runs when AI is playing (nothing to barge in on otherwise)
        const aiPlaying =
          onSpeechStart &&
          lastPlayTimestampRef &&
          Date.now() - lastPlayTimestampRef.current < AI_PLAYING_WINDOW_MS;

        // Compute RMS for every frame (needed for both detection and observability)
        let sumSq = 0;
        for (let i = 0; i < samples.length; i++) {
          sumSq += samples[i] * samples[i];
        }
        const rms = Math.sqrt(sumSq / samples.length);
        micRmsRef.current = rms;
        peakRmsRef.current = Math.max(peakRmsRef.current, rms);

        if (aiPlaying) {
          // Adaptive threshold: track echo baseline via EMA, require speech to be 3x louder
          echoBaselineRef.current =
            echoBaselineRef.current * (1 - BASELINE_ALPHA) +
            rms * BASELINE_ALPHA;
          const threshold = Math.max(
            echoBaselineRef.current * BARGE_IN_MULTIPLIER,
            MIN_RMS_THRESHOLD,
          );

          if (rms >= threshold) {
            speechFrameCountRef.current++;
            silenceFrameCountRef.current = 0;
            if (
              speechFrameCountRef.current >= SPEECH_FRAMES_REQUIRED &&
              !speechTriggeredRef.current
            ) {
              speechTriggeredRef.current = true;
              log.info("Client-side barge-in triggered", {
                rms: rms.toFixed(4),
                peakRms: peakRmsRef.current.toFixed(4),
                baseline: echoBaselineRef.current.toFixed(4),
                threshold: threshold.toFixed(4),
              });
              onSpeechStart();
            }
          } else {
            silenceFrameCountRef.current++;
            speechFrameCountRef.current = 0;
            if (silenceFrameCountRef.current >= SILENCE_FRAMES_REQUIRED) {
              speechTriggeredRef.current = false;
            }
          }

          // Observability: log RMS + peak + baseline every ~25 frames (~1s at 640-sample chunks)
          if (chunkCountRef.current % 25 === 0) {
            log.debug("Speech detection (AI playing)", {
              rms: rms.toFixed(4),
              peakRms: peakRmsRef.current.toFixed(4),
              baseline: echoBaselineRef.current.toFixed(4),
              threshold: threshold.toFixed(4),
            });
            peakRmsRef.current = 0;
          }
        } else {
          // AI not playing — decay echo baseline, reset speech state
          echoBaselineRef.current *= 0.95;
          speechFrameCountRef.current = 0;
          speechTriggeredRef.current = false;

          // Log RMS during non-AI periods to see user speech levels
          if (chunkCountRef.current % 25 === 0) {
            log.debug("Mic RMS (AI silent)", {
              rms: rms.toFixed(4),
              peakRms: peakRmsRef.current.toFixed(4),
            });
            peakRmsRef.current = 0;
          }
        }

        if (chunkCountRef.current % 25 === 0) {
          log.debug(`Captured ${chunkCountRef.current} audio chunks`);
        }
      };

      source.connect(workletNode);
      // Connect through a silent gain node — keeps the worklet processing
      // without routing mic audio to speakers (no loopback/echo)
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      workletNode.connect(silentGain);
      silentGain.connect(audioContext.destination);

      return "granted";
    } catch (err) {
      log.error("Microphone access failed", err);
      return "denied";
    }
  }, [onAudioChunk, onSpeechStart, lastPlayTimestampRef]);

  const stop = useCallback(() => {
    log.info("Audio capture stopped", {
      totalChunks: chunkCountRef.current,
    });

    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    audioContextRef.current?.close();
    audioContextRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  return { start, stop, micRmsRef };
}
