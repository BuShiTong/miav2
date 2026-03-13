interface WelcomeScreenProps {
  onStart: () => void;
  videoEnabled: boolean;
  onVideoEnabledChange: (enabled: boolean) => void;
  isStarting: boolean;
}

const features = [
  { symbol: "\u{1F399}", label: "Voice first", desc: "Talk hands-free while you cook" },
  { symbol: "\u{1F50D}", label: "Verified answers", desc: "Google Search for safe temps & techniques" },
  { symbol: "\u23F2", label: "Smart timers", desc: "Set multiple timers by voice" },
  { symbol: "\u{1F9E0}", label: "Remembers you", desc: "Allergies & preferences saved per session" },
];

export function WelcomeScreen({
  onStart,
  videoEnabled,
  onVideoEnabledChange,
  isStarting,
}: WelcomeScreenProps) {
  return (
    <div className="welcome-container">
      <div className="welcome-content">
        {/* Hero */}
        <div className="welcome-hero fade-in">
          <div className="welcome-ember-glow" aria-hidden="true" />
          <h1 className="welcome-title">Mia</h1>
          <p className="welcome-subtitle">Your AI cooking companion</p>
          <p className="welcome-pitch">
            Real-time voice assistant powered by Gemini.
            <br />
            She listens, searches, sets timers — so you
            <span className="welcome-pitch-accent"> never leave the stove.</span>
          </p>
        </div>

        {/* Features */}
        <ul className="welcome-features" aria-label="Key features">
          {features.map((f, i) => (
            <li
              key={f.label}
              className="welcome-feature fade-in"
              style={{ animationDelay: `${0.15 + i * 0.08}s` }}
            >
              <span className="welcome-feature__symbol" aria-hidden="true">
                {f.symbol}
              </span>
              <div className="welcome-feature__text">
                <span className="welcome-feature__label">{f.label}</span>
                <span className="welcome-feature__desc">{f.desc}</span>
              </div>
            </li>
          ))}
        </ul>

        {/* Mode toggle */}
        <div
          className="glass welcome-panel fade-in"
          style={{ animationDelay: "0.5s" }}
        >
          <div
            className="mode-toggle"
            role="radiogroup"
            aria-label="Session mode"
          >
            <button
              role="radio"
              aria-checked={videoEnabled}
              className={`mode-btn focus-ring${videoEnabled ? " mode-btn--active" : ""}`}
              onClick={() => onVideoEnabledChange(true)}
            >
              Audio + Video
            </button>
            <button
              role="radio"
              aria-checked={!videoEnabled}
              className={`mode-btn focus-ring${!videoEnabled ? " mode-btn--active" : ""}`}
              onClick={() => onVideoEnabledChange(false)}
            >
              Audio Only
            </button>
          </div>
          <p className="mode-description">
            {videoEnabled
              ? "Camera watches your cooking and gives visual feedback"
              : "Voice-only coaching \u2014 no camera needed"}
          </p>
        </div>

        {/* CTA */}
        <div className="fade-in" style={{ animationDelay: "0.6s" }}>
          <button
            onClick={onStart}
            disabled={isStarting}
            className="start-btn focus-ring"
            aria-label="Start cooking session"
          >
            {isStarting ? "Connecting..." : "Start Cooking"}
          </button>
          <p className="welcome-hint">Just say what you're making</p>
          <p className="welcome-hint welcome-hint--subtle">Best with headphones</p>
        </div>
      </div>
    </div>
  );
}
