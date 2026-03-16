import { useCallback, useState } from "react";
import { createLogger } from "../lib/logger";
import type { PreferenceEvent } from "./useWebSocket";

const log = createLogger("Preferences");

export type PreferenceKey = "avoid";

export type Preferences = Partial<Record<PreferenceKey, string>>;

const VALID_KEYS = new Set<string>(["avoid"]);

/** Values that mean "I have none" — not an actual preference to display. */
const NEGATION_VALUES = new Set([
  "none", "no", "nothing", "n/a", "na", "no allergies",
  "no restrictions", "no dietary restrictions", "not applicable", "clear",
]);

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>({});

  const handlePreferenceEvent = useCallback((event: PreferenceEvent) => {
    const normalizedKey = event.key?.toLowerCase();
    if (event.type === "preference_updated" && normalizedKey && VALID_KEYS.has(normalizedKey)) {
      const key = normalizedKey as PreferenceKey;
      const value = typeof event.value === "string" ? event.value.trim() : "";

      if (!value || NEGATION_VALUES.has(value.toLowerCase())) {
        // Negation or empty — remove the chip
        setPreferences((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        log.info("Preference removed", { key });
      } else {
        setPreferences((prev) => ({ ...prev, [key]: value }));
        log.info("Preference set", { key, value });
      }
    } else if (event.type === "preference_updated" && normalizedKey && !VALID_KEYS.has(normalizedKey)) {
      log.warn("Ignored invalid preference key", { key: event.key });
    }
  }, []);

  const resetPreferences = useCallback(() => {
    setPreferences({});
    log.info("Preferences reset");
  }, []);

  return { preferences, handlePreferenceEvent, resetPreferences };
}
