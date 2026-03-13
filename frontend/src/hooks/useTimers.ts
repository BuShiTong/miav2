import { useCallback, useEffect, useReducer, useRef } from "react";
import { createLogger } from "../lib/logger";

const log = createLogger("Timers");

const STORAGE_KEY = "mia_timers";

// --- Types ---

export interface Timer {
  id: string;
  label: string;
  targetTime: number; // Date.now() + duration (absolute, drift-resistant)
  durationSeconds: number; // original duration for restart
  remainingSeconds: number;
  expired: boolean;
  paused: boolean;
  hidden: boolean;
}

// --- Reducer ---

type TimerAction =
  | { type: "ADD"; id: string; label: string; durationSeconds: number }
  | { type: "REMOVE"; id: string }
  | { type: "TICK" }
  | { type: "EXPIRE"; id: string }
  | { type: "PAUSE"; id: string; remainingSeconds: number }
  | { type: "RESUME"; id: string; remainingSeconds: number }
  | { type: "ADJUST"; id: string; newRemainingSeconds: number }
  | { type: "RESTART"; id: string; durationSeconds: number }
  | { type: "HIDE"; ids: string[] }
  | { type: "SHOW"; ids: string[] }
  | { type: "RESET" };

function timerReducer(state: Timer[], action: TimerAction): Timer[] {
  switch (action.type) {
    case "ADD":
      return [
        ...state,
        {
          id: action.id,
          label: action.label,
          targetTime: Date.now() + action.durationSeconds * 1000,
          durationSeconds: action.durationSeconds,
          remainingSeconds: action.durationSeconds,
          expired: false,
          paused: false,
          hidden: false,
        },
      ];

    case "REMOVE":
      return state.filter((t) => t.id !== action.id);

    case "TICK":
      return state.map((t) => {
        if (t.paused || t.expired) return t;
        const remaining = Math.max(
          0,
          Math.ceil((t.targetTime - Date.now()) / 1000),
        );
        return { ...t, remainingSeconds: remaining };
      });

    case "EXPIRE":
      return state.map((t) =>
        t.id === action.id ? { ...t, expired: true, remainingSeconds: 0 } : t,
      );

    case "PAUSE":
      return state.map((t) =>
        t.id === action.id
          ? { ...t, paused: true, remainingSeconds: action.remainingSeconds }
          : t,
      );

    case "RESUME":
      return state.map((t) =>
        t.id === action.id
          ? {
              ...t,
              paused: false,
              targetTime: Date.now() + action.remainingSeconds * 1000,
              remainingSeconds: action.remainingSeconds,
            }
          : t,
      );

    case "ADJUST":
      return state.map((t) => {
        if (t.id !== action.id) return t;
        if (t.paused) {
          return { ...t, remainingSeconds: action.newRemainingSeconds };
        }
        return {
          ...t,
          targetTime: Date.now() + action.newRemainingSeconds * 1000,
          remainingSeconds: action.newRemainingSeconds,
        };
      });

    case "RESTART":
      return state.map((t) =>
        t.id === action.id
          ? {
              ...t,
              targetTime: Date.now() + action.durationSeconds * 1000,
              durationSeconds: action.durationSeconds,
              remainingSeconds: action.durationSeconds,
              expired: false,
              paused: false,
            }
          : t,
      );

    case "HIDE":
      return state.map((t) =>
        action.ids.includes(t.id) ? { ...t, hidden: true } : t,
      );

    case "SHOW":
      return state.map((t) =>
        action.ids.includes(t.id) ? { ...t, hidden: false } : t,
      );

    case "RESET":
      return [];

    default:
      return state;
  }
}

// --- Beep sound ---

let beepContext: AudioContext | null = null;
let beepSessionActive = false;

function playBeep(): void {
  if (!beepSessionActive) {
    log.debug("Beep suppressed — session not active");
    return;
  }
  try {
    if (!beepContext || beepContext.state === "closed") {
      beepContext = new AudioContext();
    }
    const ctx = beepContext;
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.type = "sine";
    oscillator.frequency.value = 880; // A5

    // Schedule 3 beeps atomically: 150ms on, 100ms off
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    for (let i = 0; i < 3; i++) {
      const onset = now + i * 0.25;
      gain.gain.setValueAtTime(0.3, onset);
      gain.gain.setValueAtTime(0, onset + 0.15);
    }

    oscillator.start(now);
    oscillator.stop(now + 0.75);

    log.info("Beep played");
  } catch (err) {
    log.error("Failed to play beep", { error: err });
  }
}

function closeBeepContext(): void {
  if (beepContext && beepContext.state !== "closed") {
    beepContext.close().catch(() => {});
    beepContext = null;
  }
}

// --- localStorage persistence ---

function saveTimers(timers: Timer[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(timers));
  } catch {
    // Storage full or unavailable — ignore
  }
}

function isValidTimer(t: unknown): t is Timer {
  return (
    typeof t === "object" && t !== null &&
    typeof (t as Timer).id === "string" &&
    typeof (t as Timer).label === "string" &&
    typeof (t as Timer).targetTime === "number" &&
    typeof (t as Timer).remainingSeconds === "number"
  );
}

function loadTimers(): Timer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const timers = parsed.filter(isValidTimer);
    // Recalculate remaining from absolute targetTime
    const now = Date.now();
    return timers.map((t) => {
      if (t.paused || t.expired) return t;
      const remaining = Math.max(0, Math.ceil((t.targetTime - now) / 1000));
      if (remaining <= 0) {
        return { ...t, expired: true, remainingSeconds: 0 };
      }
      return { ...t, remainingSeconds: remaining };
    });
  } catch {
    return [];
  }
}

function clearStoredTimers(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// --- Timer event from WebSocket ---

export interface TimerEvent {
  type: string;
  timer_id?: string;
  timer_ids?: string[];
  label?: string;
  duration_seconds?: number;
  remaining_seconds?: number;
  new_remaining_seconds?: number;
}

// --- Hook ---

interface UseTimersOptions {
  onTimerExpired: (timerId: string, label: string) => void;
}

export function useTimers({ onTimerExpired }: UseTimersOptions) {
  const [timers, dispatch] = useReducer((state: Timer[], action: TimerAction) => {
    const next = timerReducer(state, action);
    // Persist after every state change (except TICK — too frequent)
    if (action.type !== "TICK") {
      saveTimers(next);
    }
    return next;
  }, [], loadTimers);
  const onTimerExpiredRef = useRef(onTimerExpired);
  onTimerExpiredRef.current = onTimerExpired;

  // beepSessionActive is set to true only when a timer_set event arrives from
  // the WebSocket (line 339), not when timers restore from localStorage.
  // This prevents beeps on the WelcomeScreen from leftover timers.

  // Track which timer IDs we've already fired expiry for
  const expiredSetRef = useRef<Set<string>>(new Set());

  // Track auto-remove timeouts so they can be cancelled on unmount or manual removal
  const autoRemoveRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Single interval for all timers — drift-resistant via absolute targetTime
  const hasActiveTimer = timers.some((t) => !t.paused && !t.expired);
  useEffect(() => {
    if (!hasActiveTimer) return;

    const interval = setInterval(() => {
      dispatch({ type: "TICK" });
    }, 1000);

    return () => clearInterval(interval);
  }, [timers.length, hasActiveTimer]);

  // Detect newly expired timers after each render
  useEffect(() => {
    for (const timer of timers) {
      if (
        !timer.paused &&
        !timer.expired &&
        timer.remainingSeconds <= 0 &&
        !expiredSetRef.current.has(timer.id)
      ) {
        expiredSetRef.current.add(timer.id);
        dispatch({ type: "EXPIRE", id: timer.id });
        playBeep();
        onTimerExpiredRef.current(timer.id, timer.label);
        log.info("Timer expired", { id: timer.id, label: timer.label });

        // Auto-remove after 10 seconds (tracked for cleanup, guarded by session flag)
        const idToRemove = timer.id;
        const timeoutId = setTimeout(() => {
          if (!beepSessionActive) return;
          autoRemoveRef.current.delete(idToRemove);
          dispatch({ type: "REMOVE", id: idToRemove });
          expiredSetRef.current.delete(idToRemove);
          log.debug("Timer auto-removed", { id: idToRemove });
        }, 10_000);
        autoRemoveRef.current.set(idToRemove, timeoutId);
      }
    }
  }, [timers]);

  // Cancel all auto-remove timeouts on unmount
  useEffect(() => {
    const map = autoRemoveRef.current;
    return () => {
      for (const timeout of map.values()) clearTimeout(timeout);
      map.clear();
    };
  }, []);

  // Handle timer events from WebSocket
  const handleTimerEvent = useCallback((event: TimerEvent) => {
    log.info("Timer event received", { type: event.type });

    switch (event.type) {
      case "timer_set":
        if (event.timer_id && event.label && event.duration_seconds) {
          beepSessionActive = true;
          dispatch({
            type: "ADD",
            id: event.timer_id,
            label: event.label,
            durationSeconds: event.duration_seconds,
          });
        }
        break;

      case "timer_cancelled":
        if (event.timer_id) {
          const pending = autoRemoveRef.current.get(event.timer_id);
          if (pending) {
            clearTimeout(pending);
            autoRemoveRef.current.delete(event.timer_id);
          }
          dispatch({ type: "REMOVE", id: event.timer_id });
          expiredSetRef.current.delete(event.timer_id);
        }
        break;

      case "timer_paused":
        if (event.timer_id && event.remaining_seconds !== undefined) {
          dispatch({
            type: "PAUSE",
            id: event.timer_id,
            remainingSeconds: event.remaining_seconds,
          });
        }
        break;

      case "timer_resumed":
        if (event.timer_id && event.remaining_seconds !== undefined) {
          dispatch({
            type: "RESUME",
            id: event.timer_id,
            remainingSeconds: event.remaining_seconds,
          });
        }
        break;

      case "timer_adjusted":
        if (event.timer_id && event.new_remaining_seconds !== undefined) {
          dispatch({
            type: "ADJUST",
            id: event.timer_id,
            newRemainingSeconds: event.new_remaining_seconds,
          });
        }
        break;

      case "timer_restarted":
        if (event.timer_id && event.duration_seconds) {
          expiredSetRef.current.delete(event.timer_id);
          dispatch({
            type: "RESTART",
            id: event.timer_id,
            durationSeconds: event.duration_seconds,
          });
        }
        break;

      case "timer_hidden":
        if (event.timer_ids) {
          dispatch({ type: "HIDE", ids: event.timer_ids });
        }
        break;

      case "timer_shown":
        if (event.timer_ids) {
          dispatch({ type: "SHOW", ids: event.timer_ids });
        }
        break;
    }
  }, []);

  const resetTimers = useCallback(() => {
    beepSessionActive = false;
    closeBeepContext();
    // Clear all auto-remove timeouts
    for (const timeout of autoRemoveRef.current.values()) clearTimeout(timeout);
    autoRemoveRef.current.clear();
    expiredSetRef.current.clear();
    clearStoredTimers();
    dispatch({ type: "RESET" });
    log.info("All timers reset (session stop)");
  }, []);

  return { timers, handleTimerEvent, resetTimers };
}

// --- Helpers ---

export function formatTime(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
