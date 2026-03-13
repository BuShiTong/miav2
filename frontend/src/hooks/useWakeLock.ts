import { useCallback, useEffect, useRef } from "react";
import { createLogger } from "../lib/logger";

const log = createLogger("WakeLock");

export function useWakeLock() {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const isRequestedRef = useRef(false);
  const releaseHandlerRef = useRef<(() => void) | null>(null);

  /** Attach a release listener to the current sentinel.
   *  On system release (power management, etc.), auto-re-acquire if session is active. */
  const attachReleaseListener = () => {
    if (!wakeLockRef.current) return;
    const handler = async () => {
      log.info("Wake Lock released by system");
      wakeLockRef.current = null;
      // Re-acquire if session is still active and page is visible
      if (isRequestedRef.current && document.visibilityState === "visible") {
        try {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
          log.info("Wake Lock re-acquired after system release");
          attachReleaseListener();
        } catch (err) {
          log.warn("Wake Lock re-acquire failed after system release", { error: String(err) });
        }
      }
    };
    releaseHandlerRef.current = handler;
    wakeLockRef.current.addEventListener("release", handler);
  };

  const acquire = useCallback(async () => {
    isRequestedRef.current = true;
    if (!("wakeLock" in navigator)) {
      log.warn("Wake Lock API not supported");
      return;
    }
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      log.info("Wake Lock acquired");
      attachReleaseListener();
    } catch (err) {
      log.warn("Wake Lock request failed", { error: String(err) });
    }
  }, []);

  const release = useCallback(() => {
    isRequestedRef.current = false;
    if (wakeLockRef.current && releaseHandlerRef.current) {
      wakeLockRef.current.removeEventListener("release", releaseHandlerRef.current);
      releaseHandlerRef.current = null;
    }
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
    log.info("Wake Lock released");
  }, []);

  // Re-acquire when page becomes visible (browser releases on tab switch)
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (
        document.visibilityState === "visible" &&
        isRequestedRef.current &&
        !wakeLockRef.current
      ) {
        try {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
          log.info("Wake Lock re-acquired after visibility change");
          attachReleaseListener();
        } catch (err) {
          log.warn("Wake Lock re-acquire failed", { error: String(err) });
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  return { acquire, release };
}
