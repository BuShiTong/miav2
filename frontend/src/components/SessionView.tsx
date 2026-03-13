import type { MutableRefObject, RefObject } from "react";
import type { ButtonState } from "../App";
import type { Timer } from "../hooks/useTimers";
import type { Preferences } from "../hooks/usePreferences";
import { TimerOverlay } from "./TimerOverlay";
import { StatusBadge } from "./StatusBadge";
import { OverlayChips } from "./OverlayChips";
import { AudioVisualizer } from "./AudioVisualizer";

interface SessionViewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoEnabled: boolean;
  buttonState: ButtonState;
  voiceRingClass: string;
  buttonLabel: string;
  srAnnouncement: string;
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  isSearching: boolean;
  timers: Timer[];
  preferences: Preferences;
  micError: string | null;
  cameraError: string | null;
  wsError: string | null;
  onStop: () => void;
  onFlipCamera: () => void;
  micRmsRef: MutableRefObject<number>;
  analyserRef: MutableRefObject<AnalyserNode | null>;
  isPlaying: boolean;
}

export function SessionView({
  videoRef,
  videoEnabled,
  buttonState,
  voiceRingClass,
  buttonLabel,
  srAnnouncement,
  isConnected,
  isConnecting,
  isReconnecting,
  isSearching,
  timers,
  preferences,
  micError,
  cameraError,
  wsError,
  onStop,
  onFlipCamera,
  micRmsRef,
  analyserRef,
  isPlaying,
}: SessionViewProps) {
  const displayError = micError || cameraError || wsError;

  // Video mode: same layout skeleton as audio, camera card replaces visualizer
  if (videoEnabled) {
    return (
      <div className="session-container session-container--video">
        {/* Header */}
        <header className="session-header-new">
          <span className="session-header-new__title">Mia</span>
          <StatusBadge
            buttonState={buttonState}
            buttonLabel={buttonLabel}
            voiceRingClass={voiceRingClass}
            srAnnouncement={srAnnouncement}
            isConnected={isConnected}
            isConnecting={isConnecting}
            isReconnecting={isReconnecting}
            isSearching={isSearching}
          />
        </header>

        {/* Preferences — subtle row below header */}
        <OverlayChips preferences={preferences}  />

        {/* Error / reconnecting banners — document flow, no overlap */}
        {isReconnecting && (
          <div className="session-banner-flow session-banner--warning fade-in" role="alert">
            Connection lost — trying to reconnect...
          </div>
        )}
        {displayError && !isReconnecting && (
          <div className="session-banner-flow session-banner--error fade-in" role="alert">
            {displayError}
          </div>
        )}
        {/* Main area — camera card centered */}
        <div className="session-main">
          <div className="camera-card">
            <video
              ref={videoRef}
              muted
              playsInline
              className="video-feed"
              aria-label="Camera feed"
            />
          </div>

          {/* Timers — centered row below camera */}
          <TimerOverlay timers={timers}  />
        </div>

        {/* Footer — Stop + Flip buttons */}
        <div className="session-footer">
          <button
            onClick={onStop}
            className="stop-btn-pill focus-ring"
            aria-label="Stop cooking session"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            Stop Session
          </button>
          <button
            onClick={onFlipCamera}
            className="flip-btn focus-ring"
            aria-label="Flip camera"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
              <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
              <polyline points="16 3 19 6 16 9" />
              <polyline points="8 21 5 18 8 15" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Audio-only mode: new centered layout
  return (
    <div className="session-container">
      {/* Header */}
      <header className="session-header-new">
        <span className="session-header-new__title">Mia</span>
        <StatusBadge
          buttonState={buttonState}
          buttonLabel={buttonLabel}
          voiceRingClass={voiceRingClass}
          srAnnouncement={srAnnouncement}
          isConnected={isConnected}
          isConnecting={isConnecting}
          isReconnecting={isReconnecting}
          isSearching={isSearching}
        />
      </header>

      {/* Preferences — subtle row below header */}
      <OverlayChips preferences={preferences}  />

      {/* Error / reconnecting banners */}
      {isReconnecting && (
        <div className="session-banner-flow session-banner--warning fade-in" role="alert">
          Connection lost — trying to reconnect...
        </div>
      )}
      {displayError && !isReconnecting && (
        <div className="session-banner-flow session-banner--error fade-in" role="alert">
          {displayError}
        </div>
      )}
      {/* Main area — visualizer centered */}
      <div className="session-main">
        <div className="audio-viz" data-state={buttonState}>
          {/* Outer rings */}
          <div className={`audio-viz__ring audio-viz__ring--outer ${voiceRingClass}`} aria-hidden="true" />
          <div className={`audio-viz__ring audio-viz__ring--inner ${voiceRingClass}`} aria-hidden="true" />
          {/* Core circle with real-time visualizer */}
          <div className={`audio-viz__core audio-viz__core--${buttonState}`}>
            <AudioVisualizer
              micRmsRef={micRmsRef}
              analyserRef={analyserRef}
              isPlaying={isPlaying}
            />
          </div>
        </div>

        {/* Timers — centered row below visualizer */}
        <TimerOverlay timers={timers}  />
      </div>

      {/* Stop button */}
      <div className="session-footer">
        <button
          onClick={onStop}
          className="stop-btn-pill focus-ring"
          aria-label="Stop cooking session"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
          Stop Session
        </button>
      </div>
    </div>
  );
}
