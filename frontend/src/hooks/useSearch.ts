import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "../lib/logger";
import type { SearchEvent, SearchSource } from "./useWebSocket";

const log = createLogger("Search");
const SOURCE_DISMISS_MS = 8_000;

export function useSearch() {
  const [sources, setSources] = useState<SearchSource[]>([]);

  const sourceDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSourceDismiss = useCallback(() => {
    if (sourceDismissRef.current) {
      clearTimeout(sourceDismissRef.current);
      sourceDismissRef.current = null;
    }
  }, []);

  const handleSearchEvent = useCallback(
    (event: SearchEvent) => {
      if (event.type === "search_complete") {
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
    [clearSourceDismiss],
  );

  const resetSearch = useCallback(() => {
    clearSourceDismiss();
    setSources([]);
    log.info("Search state reset");
  }, [clearSourceDismiss]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearSourceDismiss();
    };
  }, [clearSourceDismiss]);

  return { sources, handleSearchEvent, resetSearch };
}
