import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "../lib/logger";
import type { SearchEvent } from "./useWebSocket";

const log = createLogger("Search");
const SAFETY_TIMEOUT_MS = 15_000;

export function useSearch() {
  const [isSearching, setIsSearching] = useState(false);

  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSafetyTimeout = useCallback(() => {
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }
  }, []);

  const handleSearchEvent = useCallback(
    (event: SearchEvent) => {
      if (event.type === "search_started") {
        clearSafetyTimeout();
        setIsSearching(true);
        log.info("Search started");

        // Safety timeout: auto-clear if search_complete never arrives
        safetyTimeoutRef.current = setTimeout(() => {
          setIsSearching(false);
          log.warn("Search safety timeout (15s) — auto-cleared");
        }, SAFETY_TIMEOUT_MS);
      } else if (event.type === "search_complete") {
        clearSafetyTimeout();
        setIsSearching(false);
        log.info("Search complete");
      }
    },
    [clearSafetyTimeout],
  );

  const resetSearch = useCallback(() => {
    clearSafetyTimeout();
    setIsSearching(false);
    log.info("Search state reset");
  }, [clearSafetyTimeout]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearSafetyTimeout();
    };
  }, [clearSafetyTimeout]);

  return { isSearching, handleSearchEvent, resetSearch };
}
