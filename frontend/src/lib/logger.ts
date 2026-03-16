/**
 * Lightweight module-scoped logger (console-only).
 *
 * Control verbosity:
 *   - URL param: ?log=debug
 *   - localStorage: localStorage.setItem('logLevel', 'debug')
 *   - Default: 'info'
 *
 * Usage:
 *   const log = createLogger("WebSocket");
 *   log.debug("Message received", { size: 256 });
 *   log.info("Connected");
 *   log.warn("Buffer underrun");
 *   log.error("Parse failed", err);
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function resolveLevel(): number {
  try {
    const url = new URLSearchParams(window.location.search);
    const param = url.get("log");
    if (param && param in LEVEL_VALUE)
      return LEVEL_VALUE[param as LogLevel];

    const stored = localStorage.getItem("logLevel");
    if (stored && stored in LEVEL_VALUE)
      return LEVEL_VALUE[stored as LogLevel];
  } catch {
    // SSR or restricted environment
  }
  return LEVEL_VALUE.info;
}

const MIN_LEVEL = resolveLevel();

// --- Session context ---

let _sessionId: string | null =
  `page_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

/** Set the real session ID once WebSocket connects (used for cross-file correlation). */
export function setSessionId(id: string): void {
  _sessionId = id;
}

// --- Logger factory ---

export interface Logger {
  debug: (msg: string, data?: unknown) => void;
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
}

export function createLogger(module: string): Logger {
  function emit(level: LogLevel, msg: string, data?: unknown) {
    if (LEVEL_VALUE[level] < MIN_LEVEL) return;

    const ts = new Date().toISOString().slice(11, 23);
    const prefix = `[${ts}] [${level.toUpperCase()}] ${module}:`;
    const method =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : console.log;

    if (data !== undefined) {
      method(prefix, msg, data);
    } else {
      method(prefix, msg);
    }
  }

  return {
    debug: (msg, data?) => emit("debug", msg, data),
    info: (msg, data?) => emit("info", msg, data),
    warn: (msg, data?) => emit("warn", msg, data),
    error: (msg, data?) => emit("error", msg, data),
  };
}
