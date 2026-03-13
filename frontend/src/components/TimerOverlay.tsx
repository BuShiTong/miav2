import { type Timer, formatTime } from "../hooks/useTimers";

interface TimerOverlayProps {
  timers: Timer[];
}

export function TimerOverlay({ timers }: TimerOverlayProps) {
  if (timers.length === 0) return null;

  return (
    <div className="timer-row" role="region" aria-label="Active timers">
      {timers.map((timer) => {
        const isWarning =
          !timer.paused &&
          !timer.expired &&
          timer.remainingSeconds <= 10 &&
          timer.remainingSeconds > 0;

        const chipClass = [
          "timer-chip fade-in",
          timer.expired ? "timer-chip--expired" : "",
          timer.paused ? "timer-chip--paused" : "",
          isWarning ? "timer-chip--warning" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={timer.id}
            className={chipClass}
            aria-live={timer.expired ? "assertive" : "off"}
            aria-label={`${timer.label}: ${timer.expired ? "done" : timer.paused ? "paused" : formatTime(timer.remainingSeconds)}`}
          >
            <span className="timer-chip__label">{timer.label}</span>
            <span className="timer-chip__time">
              {timer.expired
                ? "Done!"
                : timer.paused
                  ? `${formatTime(timer.remainingSeconds)} (Paused)`
                  : formatTime(timer.remainingSeconds)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
