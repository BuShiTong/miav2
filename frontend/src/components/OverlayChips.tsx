import type { Preferences } from "../hooks/usePreferences";

interface OverlayChipsProps {
  preferences: Preferences;
}

/** Parse "peanuts (allergy), vegan (dietary)" into structured items. */
function parseAvoidItems(raw: string): { value: string; reason: string }[] {
  return raw.split(", ").map((part) => {
    const match = part.trim().match(/^(.+?)\s*\((\w+)\)$/);
    if (match) return { value: match[1].trim(), reason: match[2].trim() };
    return { value: part.trim(), reason: "dislike" };
  }).filter((item) => item.value);
}

/** Format chip text: allergies/dislikes get "No X", dietary shows as-is. */
function chipText(value: string, reason: string): string {
  if (reason === "dietary") return value.charAt(0).toUpperCase() + value.slice(1);
  return `No ${value}`;
}

export function OverlayChips({ preferences }: OverlayChipsProps) {
  const hasPreferences = Object.keys(preferences).length > 0;
  if (!hasPreferences) return null;

  const avoidItems = preferences.avoid ? parseAvoidItems(preferences.avoid) : [];

  return (
    <div
      className="pref-row fade-in"
      role="status"
      aria-live="polite"
      aria-label="Your preferences"
    >
      {avoidItems.map((item) => (
        <span
          key={item.value}
          className={`chip ${item.reason === "allergy" ? "chip--allergy" : "chip--preference"}`}
        >
          {chipText(item.value, item.reason)}
        </span>
      ))}
      {preferences.serving_size && (
        <span className="chip chip--preference">
          Serves {preferences.serving_size}
        </span>
      )}
    </div>
  );
}
