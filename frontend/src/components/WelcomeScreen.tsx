interface WelcomeScreenProps {
  onStart: () => void;
  videoEnabled: boolean;
  onVideoEnabledChange: (enabled: boolean) => void;
  isStarting: boolean;
  accessCode: string;
  onAccessCodeChange: (code: string) => void;
  codeError: string;
}

const features = [
  "No typing. No tapping. Just talk.",
  "Need a temp or recipe? She looks it up.",
  "Set timers by voice. She tracks them all.",
  "Show her your pan. She'll say when it looks done.",
  "Something went wrong? She'll help you fix it.",
];

export function WelcomeScreen({
  onStart,
  videoEnabled,
  onVideoEnabledChange,
  isStarting,
  accessCode,
  onAccessCodeChange,
  codeError,
}: WelcomeScreenProps) {
  return (
    <div className="welcome-container">
      <div className="welcome-content">
        {/* Hero */}
        <div className="welcome-hero">
          <h1 className="welcome-title">Mia</h1>
          <p className="welcome-subtitle">Your AI sous chef</p>
          <p className="welcome-pitch">
            Real-time voice assistant powered by Gemini.
          </p>
        </div>

        {/* Features */}
        <ul className="welcome-features" aria-label="Key features">
          {features.map((text, i) => (
            <li
              key={i}
              className="welcome-feature"
              style={{ animationDelay: `${0.15 + i * 0.08}s` }}
            >
              {text}
            </li>
          ))}
        </ul>

        {/* Mode toggle */}
        <div className="welcome-panel">
          <div
            className="mode-toggle"
            role="radiogroup"
            aria-label="Session mode"
          >
            <button
              role="radio"
              aria-checked={!videoEnabled}
              className={`mode-btn focus-ring${!videoEnabled ? " mode-btn--active" : ""}`}
              onClick={() => onVideoEnabledChange(false)}
            >
              Audio Only
            </button>
            <button
              role="radio"
              aria-checked={videoEnabled}
              className={`mode-btn focus-ring${videoEnabled ? " mode-btn--active" : ""}`}
              onClick={() => onVideoEnabledChange(true)}
            >
              Audio + Video
            </button>
          </div>
          <p className="mode-description">
            {videoEnabled
              ? "Camera watches your cooking and gives visual feedback"
              : "Voice-only coaching, no camera needed"}
          </p>
        </div>

        {/* Access Code */}
        <div className="welcome-code-section">
          <label htmlFor="access-code" className="welcome-code-label">
            Access code
          </label>
          <input
            id="access-code"
            type="password"
            className={`welcome-code-input${codeError ? " welcome-code-input--error" : ""}`}
            placeholder="Enter access code"
            value={accessCode}
            onChange={(e) => onAccessCodeChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && accessCode.trim() && !isStarting) {
                onStart();
              }
            }}
            autoFocus
            autoComplete="off"
            maxLength={100}
            disabled={isStarting}
            aria-invalid={!!codeError}
            aria-describedby={codeError ? "code-error" : undefined}
          />
          {codeError && (
            <p
              id="code-error"
              className="welcome-code-error"
              role="alert"
              aria-live="polite"
            >
              {codeError}
            </p>
          )}
        </div>

        {/* CTA */}
        <div>
          <button
            onClick={onStart}
            disabled={isStarting || !accessCode.trim()}
            className="start-btn focus-ring"
            aria-label="Start cooking session"
          >
            {isStarting ? "Connecting..." : "Start Cooking"}
          </button>
          <p className="welcome-hint welcome-hint--subtle">Best with headphones</p>
        </div>
      </div>
    </div>
  );
}
