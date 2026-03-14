import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "../lib/logger";
import type { SearchEvent, SearchSource } from "./useWebSocket";

const log = createLogger("Search");
const SAFETY_TIMEOUT_MS = 15_000;
const SOURCE_DISMISS_MS = 8_000;

export function useSearch() {
  const [isSearching, setIsSearching] = useState(false);
  const [sources, setSources] = useState<SearchSource[]>([]);

  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSafetyTimeout = useCallback(() => {
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }
  }, []);

  const clearSourceDismiss = useCallback(() => {
    if (sourceDismissRef.current) {
      clearTimeout(sourceDismissRef.current);
      sourceDismissRef.current = null;
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

        const newSources = event.sources || [];
        setSources(newSources);
        log.info("Search complete", { sourceCount: newSources.length });

        // Auto-dismiss sources after 8 seconds
        clearSourceDismiss();
        if (newSources.length > 0) {
          sourceDismissRef.current = setTimeout(() => {
            setSources([]);
            log.info("Sources auto-dismissed");
          }, SOURCE_DISMISS_MS);
        }
      }
    },
    [clearSafetyTimeout, clearSourceDismiss],
  );

  const resetSearch = useCallback(() => {
    clearSafetyTimeout();
    clearSourceDismiss();
    setIsSearching(false);
    setSources([]);
    log.info("Search state reset");
  }, [clearSafetyTimeout, clearSourceDismiss]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearSafetyTimeout();
      clearSourceDismiss();
    };
  }, [clearSafetyTimeout, clearSourceDismiss]);

  return { isSearching, sources, handleSearchEvent, resetSearch };
}
