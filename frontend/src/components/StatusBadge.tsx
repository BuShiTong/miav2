import type { ButtonState } from "../App";

interface StatusBadgeProps {
  buttonState: ButtonState;
  buttonLabel: string;
  voiceRingClass: string;
  srAnnouncement: string;
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  isSearching: boolean;
}

export function StatusBadge({
  buttonState,
  buttonLabel,
  voiceRingClass,
  srAnnouncement,
  isConnected,
  isConnecting,
  isReconnecting,
  isSearching,
}: StatusBadgeProps) {
  const dotColor = isSearching
    ? "var(--warning)"
    : isConnected
      ? "var(--accent)"
      : isConnecting || isReconnecting
        ? "var(--warning)"
        : "var(--text-tertiary)";

  const dotClass =
    buttonState === "listening" || buttonState === "searching" || buttonState === "processing"
      ? "status-badge__dot status-badge__dot--pulse"
      : "status-badge__dot";

  return (
    <div className="status-badge-wrapper">
      <div className={`${voiceRingClass} voice-ring--badge`} />
      <div className="glass status-badge">
        <span className={dotClass} style={{ backgroundColor: dotColor }} />
        <span className="status-badge__label">{buttonLabel}</span>
      </div>
      <span className="sr-only" aria-live="polite" role="status">
        {srAnnouncement}
      </span>
    </div>
  );
}
