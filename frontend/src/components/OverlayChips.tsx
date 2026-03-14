import type { Preferences } from "../hooks/usePreferences";

interface OverlayChipsProps {
  preferences: Preferences;
}

export function OverlayChips({ preferences }: OverlayChipsProps) {
  const hasPreferences = Object.keys(preferences).length > 0;
  if (!hasPreferences) return null;

  return (
    <div
      className="pref-row fade-in"
      role="status"
      aria-live="polite"
      aria-label="Your preferences"
    >
      {preferences.allergies && (
        <span className="chip chip--preference">
          No {preferences.allergies}
        </span>
      )}
      {preferences.dietary && (
        <span className="chip chip--preference">
          {preferences.dietary}
        </span>
      )}
      {preferences.serving_size && (
        <span className="chip chip--preference">
          Serves {preferences.serving_size}
        </span>
      )}
    </div>
  );
}
