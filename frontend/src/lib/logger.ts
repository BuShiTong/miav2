/**
 * Lightweight module-scoped logger with remote log shipping.
 *
 * Control console verbosity:
 *   - URL param: ?log=debug
 *   - localStorage: localStorage.setItem('logLevel', 'debug')
 *   - Default: 'info'
 *
 * Log file capture defaults to INFO level. Override with:
 *   - URL param: ?fileLog=debug
 *   - localStorage: localStorage.setItem('fileLogLevel', 'debug')
 * Logs are shipped to the backend every 3s and written to logs/frontend.log.
 *
 * Usage:
 *   const log = createLogger("WebSocket");
 *   log.debug("Message received", { size: 256 });
 *   log.info("Connected");
 *   log.warn("Buffer underrun");
 *   log.error("Parse failed", err);
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: string;
  module: string;
  sessionId: string | null;
  msg: string;
  data: unknown;
}

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
    // SSR or restricted environment — fall through to default
  }
  return LEVEL_VALUE.info;
}

function resolveFileLevel(): number {
  try {
    const url = new URLSearchParams(window.location.search);
    const param = url.get("fileLog");
    if (param && param in LEVEL_VALUE)
      return LEVEL_VALUE[param as LogLevel];

    const stored = localStorage.getItem("fileLogLevel");
    if (stored && stored in LEVEL_VALUE)
      return LEVEL_VALUE[stored as LogLevel];
  } catch {
    // SSR or restricted environment — fall through to default
  }
  return LEVEL_VALUE.debug; // TEMPORARY: capture all events for pre-deployment testing
}

// Resolve once at module load (avoids per-call overhead)
const MIN_LEVEL = resolveLevel();
const FILE_MIN_LEVEL = resolveFileLevel();

// --- Session context ---

let _sessionId: string | null =
  `page_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

/** Set the real session ID once WebSocket connects (used for cross-file correlation). */
export function setSessionId(id: string): void {
  _sessionId = id;
}

// --- Safe serialization ---

function _safeSerialize(data: unknown): unknown {
  if (data === undefined || data === null) return null;
  if (
    typeof data === "string" ||
    typeof data === "number" ||
    typeof data === "boolean"
  )
    return data;
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return String(data);
  }
}

// --- Remote log buffer ---

const MAX_BUFFER_SIZE = 500;

let _buffer: LogEntry[] = [];
let _inflightBatch: LogEntry[] | null = null;

async function _flushLogs(): Promise<void> {
  if (_buffer.length === 0 || _inflightBatch) return;

  const batch = _buffer;
  _buffer = [];
  _inflightBatch = batch;

  try {
    const res = await fetch("/api/frontend-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logs: batch }),
    });
    if (!res.ok) {
      console.warn("[Logger] Log flush failed: HTTP", res.status);
      _buffer = batch.concat(_buffer);
    }
  } catch {
    console.warn("[Logger] Log flush failed: network error");
    _buffer = batch.concat(_buffer);
  } finally {
    _inflightBatch = null;
  }
}

// Flush every 3 seconds
setInterval(_flushLogs, 3000);

// Guaranteed flush on page close (includes any in-flight batch that will be cancelled)
window.addEventListener("beforeunload", () => {
  const final = _inflightBatch ? _inflightBatch.concat(_buffer) : _buffer;
  if (final.length === 0) return;
  const blob = new Blob([JSON.stringify({ logs: final })], {
    type: "application/json",
  });
  navigator.sendBeacon("/api/frontend-logs", blob);
});

// --- Startup banner ---

_buffer.push({
  ts: new Date().toISOString(),
  level: "INFO",
  module: "Logger",
  sessionId: _sessionId,
  msg: "SESSION_START",
  data: {
    userAgent: navigator.userAgent,
    url: window.location.href,
    logLevel:
      Object.entries(LEVEL_VALUE).find(([, v]) => v === MIN_LEVEL)?.[0] ??
      "info",
    fileLogLevel:
      Object.entries(LEVEL_VALUE).find(([, v]) => v === FILE_MIN_LEVEL)?.[0] ??
      "info",
  },
});

// --- Logger factory ---

export interface Logger {
  debug: (msg: string, data?: unknown) => void;
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
}

export function createLogger(module: string): Logger {
  function emit(level: LogLevel, msg: string, data?: unknown) {
    // Buffer for remote file logging (respects file log level)
    if (LEVEL_VALUE[level] >= FILE_MIN_LEVEL) {
      if (_buffer.length >= MAX_BUFFER_SIZE) {
        _buffer.splice(0, 100); // drop oldest entries to prevent memory growth
      }
      _buffer.push({
        ts: new Date().toISOString(),
        level: level.toUpperCase(),
        module,
        sessionId: _sessionId,
        msg,
        data: _safeSerialize(data),
      });
    }

    // Flush immediately on errors (page might crash before next interval)
    if (level === "error") {
      _flushLogs();
    }

    // Console output still respects MIN_LEVEL
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
