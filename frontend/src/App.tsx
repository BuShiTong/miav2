import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { useAudioPlayback } from "./hooks/useAudioPlayback";
import { usePreferences } from "./hooks/usePreferences";
import { useSearch } from "./hooks/useSearch";
import { useTimers, type TimerEvent } from "./hooks/useTimers";
import { useVideoCapture } from "./hooks/useVideoCapture";
import { useWakeLock } from "./hooks/useWakeLock";
import { useWebSocket } from "./hooks/useWebSocket";
import { createLogger } from "./lib/logger";
import { playConnectSound, playTimerSetSound, closeSoundContext } from "./lib/uiSounds";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { SessionView } from "./components/SessionView";
import { useDemoSession } from "./hooks/useDemoSession";

const log = createLogger("App");

// Global error handlers — capture unhandled errors to the log file
window.addEventListener("error", (e) => {
  log.error("Unhandled error", {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    stack: e.error?.stack,
  });
});

window.addEventListener("unhandledrejection", (e) => {
  log.error("Unhandled promise rejection", {
    reason: String(e.reason),
    stack: e.reason?.stack,
  });
});

/** Trigger device vibration if supported (no-op on desktop). */
function vibrate(pattern: number | number[]) {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

export type ButtonState =
  | "idle"
  | "connecting"
  | "reconnecting"
  | "listening"
  | "speaking"
  | "searching"
  | "processing";

const isPreviewAvailable = new URLSearchParams(window.location.search).has("preview");

function App() {
  const [demoMode, setDemoMode] = useState(false);
  const demo = useDemoSession();

  const videoElementRef = useRef<HTMLVideoElement>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [accessCode, setAccessCode] = useState(() => sessionStorage.getItem('mia-access-code') || '');
  const [codeError, setCodeError] = useState('');
  const pendingCameraRef = useRef(false);
  const isStartingRef = useRef(false);

  // Processing state: set when user finishes speaking, cleared when AI audio arrives
  const isProcessingRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Processing state is purely informational — no automatic recovery.
  // If Gemini is stuck, user naturally recovers by speaking or tapping Stop.

  // ── Hooks ──────────────────────────────────────────────────────

  const {
    start: startPlayback,
    playAudio,
    flushAudio,
    stop: stopPlayback,
    lastPlayTimestampRef,
    isPlaying,
    analyserRef,
  } = useAudioPlayback();

  const { acquire: acquireWakeLock, release: releaseWakeLock } = useWakeLock();

  const handleTimerExpired = useCallback(
    (timerId: string, label: string) => {
      sendTimerExpiredRef.current(timerId, label);
      vibrate([100, 50, 100, 50, 100]);
    },
    [],
  );
  const { timers, handleTimerEvent, resetTimers } = useTimers({
    onTimerExpired: handleTimerExpired,
  });

  // Haptic when timer enters warning zone (≤10s)
  const warningHapticFiredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const timer of timers) {
      if (
        !timer.paused &&
        !timer.expired &&
        timer.remainingSeconds <= 10 &&
        timer.remainingSeconds > 0
      ) {
        if (!warningHapticFiredRef.current.has(timer.id)) {
          warningHapticFiredRef.current.add(timer.id);
          vibrate([50, 30, 50]);
        }
      }
      if (timer.remainingSeconds > 10) {
        warningHapticFiredRef.current.delete(timer.id);
      }
    }
  }, [timers]);

  const onTimerEvent = useCallback(
    (event: { type: string; [key: string]: unknown }) => {
      if (event.type === "timer_set") playTimerSetSound();
      handleTimerEvent(event as TimerEvent);
    },
    [handleTimerEvent],
  );

  const { isSearching, handleSearchEvent, resetSearch } =
    useSearch();

  const { preferences, handlePreferenceEvent, resetPreferences } =
    usePreferences();

  // Wrap playAudio to clear processing state when first audio arrives
  const handleAudioData = useCallback(
    (pcmBase64: string) => {
      if (isProcessingRef.current) {
        isProcessingRef.current = false;
        setIsProcessing(false);
        log.info("Processing cleared (audio arrived)");
      }
      playAudio(pcmBase64);
    },
    [playAudio],
  );

  const handleProcessing = useCallback(() => {
    isProcessingRef.current = true;
    setIsProcessing(true);
    log.info("Processing started (user finished speaking)");
  }, []);

  const handleReady = useCallback(() => {
    playConnectSound();
  }, []);

  const {
    status,
    error: wsError,
    connect,
    disconnect,
    sendAudio,
    sendImage,
    sendCameraState,
    sendBargeIn,
    sendTimerExpired,
  } = useWebSocket({
    onAudioData: handleAudioData,
    onInterrupted: flushAudio,
    onTimerEvent,
    onSearchEvent: handleSearchEvent,
    onPreferenceEvent: handlePreferenceEvent,
    onProcessing: handleProcessing,
    onReady: handleReady,
  });

  const sendTimerExpiredRef = useRef(sendTimerExpired);
  sendTimerExpiredRef.current = sendTimerExpired;

  const handleSpeechStart = useCallback(() => {
    flushAudio();
    sendBargeIn();
  }, [flushAudio, sendBargeIn]);

  const { start: startMic, stop: stopMic, micRmsRef } = useAudioCapture({
    onAudioChunk: sendAudio,
    onSpeechStart: handleSpeechStart,
    lastPlayTimestampRef,
  });

  const { start: startCamera, stop: stopCamera, flip: flipCamera } = useVideoCapture({
    onFrame: sendImage,
  });

  // ── Processing stuck recovery ─────────────────────────────────
  // Connection sound moved to handleReady — plays when AI session is live,
  // not just when WebSocket opens (which is before Gemini is ready).

  // ── Derived state ──────────────────────────────────────────────

  const isConnecting = status === "connecting";
  const isConnected = status === "connected";
  const isReconnecting = status === "reconnecting";

  const buttonState: ButtonState = !isActive
    ? "idle"
    : isReconnecting
      ? "reconnecting"
      : isConnecting
        ? "connecting"
        : isPlaying
          ? "speaking"
          : isSearching
            ? "searching"
            : isProcessing
              ? "processing"
              : "listening";

  const VOICE_RING: Record<ButtonState, string> = {
    idle: "voice-ring voice-ring--idle",
    connecting: "voice-ring voice-ring--connecting",
    reconnecting: "voice-ring voice-ring--reconnecting",
    listening: "voice-ring voice-ring--listening",
    speaking: "voice-ring voice-ring--speaking",
    searching: "voice-ring voice-ring--searching",
    processing: "voice-ring voice-ring--processing",
  };

  const BUTTON_LABEL: Record<ButtonState, string> = {
    idle: "Start",
    connecting: "Connecting...",
    reconnecting: "Reconnecting...",
    listening: "Listening...",
    speaking: "Speaking...",
    searching: "Searching...",
    processing: "Processing...",
  };

  const SR_ANNOUNCEMENT: Record<ButtonState, string> = {
    idle: "",
    connecting: "Connecting to AI",
    reconnecting: "Reconnecting to AI",
    listening: "AI is listening",
    speaking: "AI is speaking",
    searching: "Searching the web",
    processing: "AI is processing",
  };

  const voiceRingClass = VOICE_RING[buttonState];
  const buttonLabel = BUTTON_LABEL[buttonState];
  const srAnnouncement = SR_ANNOUNCEMENT[buttonState];

  // ── Auto-dismiss transient errors after 8 seconds ────────────
  // micError is persistent (needs user action). Camera and WS errors fade out.

  useEffect(() => {
    if (!cameraError) return;
    const t = setTimeout(() => setCameraError(null), 8000);
    return () => clearTimeout(t);
  }, [cameraError]);

  const [wsErrorHidden, setWsErrorHidden] = useState(false);
  useEffect(() => {
    setWsErrorHidden(false);
    if (!wsError) return;
    const t = setTimeout(() => setWsErrorHidden(true), 8000);
    return () => clearTimeout(t);
  }, [wsError]);

  const visibleWsError = wsError && !wsErrorHidden ? wsError : null;

  const handleAccessCodeChange = useCallback((code: string) => {
    setAccessCode(code);
    setCodeError('');
    sessionStorage.setItem('mia-access-code', code);
  }, []);

  // ── Camera start after SessionView renders ─────────────────────

  useEffect(() => {
    if (isActive && pendingCameraRef.current && videoElementRef.current) {
      pendingCameraRef.current = false;
      startCamera(videoElementRef.current).then((result) => {
        if (result === "denied") {
          setCameraError("Camera unavailable — using audio only");
        } else {
          sendCameraState(true);
        }
      });
    }
  }, [isActive, startCamera, sendCameraState]);

  // ── Session lifecycle ──────────────────────────────────────────

  const verifyAccessCode = useCallback(async (code: string): Promise<{ valid: boolean; error?: string }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch('/api/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) return { valid: false, error: 'Could not verify code. Try again.' };
      const data = await res.json();
      if (!data.valid) return { valid: false, error: data.error || 'Invalid access code' };
      return { valid: true };
    } catch (err) {
      clearTimeout(timeout);
      return {
        valid: false,
        error: err instanceof DOMException && err.name === 'AbortError'
          ? 'The server hamster stopped running. Is the server up?'
          : 'The server went offline \u2014 maybe someone watered the servers again?',
      };
    }
  }, []);

  const handleStart = useCallback(async () => {
    // Synchronous guard: React batches state updates, so isStarting alone
    // can't prevent two rapid clicks from both entering this function.
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    // Browser feature detection
    if (!window.AudioContext || !window.AudioWorkletNode || !navigator.mediaDevices?.getUserMedia) {
      setMicError("Voice chat needs Chrome or Edge \u2014 this browser can't handle the heat!");
      isStartingRef.current = false;
      return;
    }

    setMicError(null);
    setCameraError(null);
    setCodeError('');
    setIsStarting(true);

    try {
      // Run code verification, playback setup, and mic setup in parallel.
      // This saves ~200-600ms vs the previous sequential approach.
      const [codeResult, , micResult] = await Promise.all([
        verifyAccessCode(accessCode),
        startPlayback(),
        startMic(),
      ]);

      // Check code verification result — bail before opening WebSocket
      // so Vertex AI billing never starts for invalid codes.
      if (!codeResult.valid) {
        setCodeError(codeResult.error || 'Invalid access code');
        stopMic();
        stopPlayback();
        return;
      }

      // Check mic permission
      if (micResult === "denied") {
        setMicError("My AI ears need your mic permission \u2014 I can't eavesdrop without it!");
        stopPlayback();
        return;
      }

      // All checks passed — now open WebSocket (triggers Vertex AI session)
      acquireWakeLock();
      connect();
      setIsActive(true);
    } catch (err) {
      log.error("Failed to start session", err);
      stopMic();
      disconnect();
      stopPlayback();
      releaseWakeLock();
    } finally {
      setIsStarting(false);
      isStartingRef.current = false;
    }
  }, [
    connect,
    disconnect,
    startMic,
    stopMic,
    startPlayback,
    stopPlayback,
    acquireWakeLock,
    releaseWakeLock,
    accessCode,
    verifyAccessCode,
  ]);

  const handleStop = useCallback(() => {
    stopCamera();
    stopMic();
    disconnect();
    stopPlayback();
    releaseWakeLock();
    resetSearch();
    resetPreferences();
    resetTimers();
    closeSoundContext();
    isProcessingRef.current = false;
    setIsProcessing(false);
    setIsActive(false);
    pendingCameraRef.current = false;
  }, [
    stopCamera,
    stopMic,
    disconnect,
    stopPlayback,
    releaseWakeLock,
    resetSearch,
    resetPreferences,
    resetTimers,
  ]);

  // ── Camera toggle (mid-session) ──────────────────────────────

  const isTogglingCameraRef = useRef(false);

  const handleToggleCamera = useCallback(async () => {
    if (isTogglingCameraRef.current) return;
    isTogglingCameraRef.current = true;

    try {
      if (videoEnabled) {
        // Turn OFF
        stopCamera();
        sendCameraState(false);
        setVideoEnabled(false);
      } else {
        // Turn ON
        setVideoEnabled(true);
        pendingCameraRef.current = true;
      }
    } finally {
      isTogglingCameraRef.current = false;
    }
  }, [videoEnabled, stopCamera, sendCameraState]);

  const visibleTimers = timers.filter((t) => !t.hidden);

  // ── Render ─────────────────────────────────────────────────────

  if (demoMode) {
    return (
      <div className="page-enter" key="demo">
        <div className="session-banner-flow session-banner--preview fade-in" role="status">
          Preview Mode — no backend connected
        </div>
        <SessionView
          videoRef={videoElementRef}
          videoEnabled={false}
          buttonState={demo.buttonState}
          voiceRingClass={demo.voiceRingClass}
          buttonLabel={demo.buttonLabel}
          srAnnouncement={demo.srAnnouncement}
          isConnected={demo.isConnected}
          isConnecting={demo.isConnecting}
          isReconnecting={demo.isReconnecting}
          isSearching={demo.isSearching}
          timers={demo.timers}
          preferences={demo.preferences}
          micError={demo.micError}
          cameraError={demo.cameraError}
          wsError={demo.wsError}
          onStop={() => setDemoMode(false)}
          onFlipCamera={demo.onFlipCamera}
          onToggleCamera={() => {}}
          micRmsRef={demo.micRmsRef}
          analyserRef={demo.analyserRef}
          isPlaying={demo.isPlaying}
        />
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="page-enter" key="welcome">
        <WelcomeScreen
          onStart={handleStart}
          isStarting={isStarting}
          accessCode={accessCode}
          onAccessCodeChange={handleAccessCodeChange}
          codeError={codeError}
          onPreview={isPreviewAvailable ? () => setDemoMode(true) : undefined}
        />
      </div>
    );
  }

  return (
    <div className="page-enter" key="session">
      <SessionView
        videoRef={videoElementRef}
        videoEnabled={videoEnabled}
        buttonState={buttonState}
        voiceRingClass={voiceRingClass}
        buttonLabel={buttonLabel}
        srAnnouncement={srAnnouncement}
        isConnected={isConnected}
        isConnecting={isConnecting}
        isReconnecting={isReconnecting}
        isSearching={isSearching}
        timers={visibleTimers}
        preferences={preferences}
        micError={micError}
        cameraError={cameraError}
        wsError={visibleWsError}
        onStop={handleStop}
        onFlipCamera={flipCamera}
        onToggleCamera={handleToggleCamera}
        micRmsRef={micRmsRef}
        analyserRef={analyserRef}
        isPlaying={isPlaying}
      />
    </div>
  );
}

export default App;
