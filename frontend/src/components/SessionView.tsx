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
  onToggleCamera: () => void;
  cameraStarting: boolean;
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
  onToggleCamera,
  cameraStarting,
  micRmsRef,
  analyserRef,
  isPlaying,
}: SessionViewProps) {
  const displayError = micError || cameraError || wsError;

  return (
    <div className={`session-container${videoEnabled ? " session-container--video" : ""}`}>
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

      {/* Timers in normal flow (audio mode only) */}
      {!videoEnabled && <TimerOverlay timers={timers} />}

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

      {/* Main area — visualizer or camera */}
      <div className="session-main">
        {videoEnabled ? (
          <div className={`camera-card camera-card--${buttonState}`}>
            <video
              ref={videoRef}
              muted
              playsInline
              className="video-feed"
              aria-label="Camera feed"
            />
            {cameraStarting && (
              <div className="camera-card__loading">
                <span>Starting camera...</span>
              </div>
            )}
            {/* Floating timers over camera top */}
            <div className="camera-card__overlay camera-card__overlay--top">
              <TimerOverlay timers={timers} />
            </div>
            {/* Floating prefs over camera bottom */}
            <div className="camera-card__overlay camera-card__overlay--bottom">
              <OverlayChips preferences={preferences} />
            </div>
          </div>
        ) : (
          <div className="audio-viz" data-state={buttonState}>
            <div className={`audio-viz__ring audio-viz__ring--outer ${voiceRingClass}`} aria-hidden="true" />
            <div className={`audio-viz__ring audio-viz__ring--inner ${voiceRingClass}`} aria-hidden="true" />
            <div className={`audio-viz__core audio-viz__core--${buttonState}`}>
              <AudioVisualizer
                micRmsRef={micRmsRef}
                analyserRef={analyserRef}
                isPlaying={isPlaying}
              />
            </div>
          </div>
        )}
      </div>

      {/* Hidden video element when camera is off — keeps ref valid for startCamera */}
      {!videoEnabled && (
        <video
          ref={videoRef}
          muted
          playsInline
          style={{ display: "none" }}
          aria-hidden="true"
        />
      )}

      {/* Preferences in normal flow (audio mode only) */}
      {!videoEnabled && <OverlayChips preferences={preferences} />}

      {/* Footer — camera toggle + stop + flip */}
      <div className="session-footer">
        <button
          onClick={onToggleCamera}
          className={`camera-toggle-btn focus-ring${videoEnabled ? " camera-toggle-btn--active" : ""}`}
          aria-label={videoEnabled ? "Turn off camera" : "Turn on camera"}
        >
          {videoEnabled ? (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9.34" />
              <path d="M15 11a3 3 0 0 0-5.94-.6" />
            </svg>
          ) : (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          )}
        </button>

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

        {videoEnabled && (
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
        )}
      </div>
    </div>
  );
}
