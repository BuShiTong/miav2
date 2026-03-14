import { useCallback, useRef, useState } from "react";
import { createLogger, setSessionId } from "../lib/logger";

const log = createLogger("WebSocket");

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

// --- Custom event types from backend ---

export type SearchEvent =
  | { type: "search_started" }
  | { type: "search_complete" };

export interface PreferenceEvent {
  type: "preference_updated";
  key: string;
  value: string;
}

export interface CameraEvent {
  type: "camera_control";
  action: "on" | "off" | "flip";
}

interface UseWebSocketOptions {
  onAudioData: (pcmBase64: string) => void;
  onInterrupted: () => void;
  onTimerEvent?: (event: { type: string; [key: string]: unknown }) => void;
  onSearchEvent?: (event: SearchEvent) => void;
  onPreferenceEvent?: (event: PreferenceEvent) => void;
  onCameraEvent?: (event: CameraEvent) => void;
  onProcessing?: () => void;
  onReady?: () => void;
}

export function useWebSocket({ onAudioData, onInterrupted, onTimerEvent, onSearchEvent, onPreferenceEvent, onCameraEvent, onProcessing, onReady }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const audioSendCountRef = useRef(0);
  // Stable user_id across reconnects (generated once per Start, reused on auto-reconnect)
  const userIdRef = useRef<string | null>(null);

  // Tracks whether we've ever successfully connected (suppresses audio drop
  // warnings during initial connect — mic starts before WS opens)
  const hasEverConnectedRef = useRef(false);
  // Session duration tracking
  const sessionStartTimeRef = useRef<number>(0);

  // Auto-reconnect state (exponential backoff with jitter)
  const reconnectAttemptsRef = useRef(0);
  const isReconnectingRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const BASE_DELAY_MS = 1500;

  // Ref to always hold the latest connect — used by reconnect setTimeout
  // to avoid stale closures after re-renders
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (wsRef.current) return;

    setError(null);
    if (!isReconnectingRef.current) {
      setStatus("connecting");
    }

    // Stable user_id: generate once, reuse across reconnects so backend can
    // look up resume tokens and preferences for the same user.
    if (!userIdRef.current) {
      userIdRef.current = `user_${crypto.randomUUID()}`;
    }
    const userId = userIdRef.current;
    const sessionId = `session_${crypto.randomUUID()}`;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/${userId}/${sessionId}`;

    setSessionId(sessionId);
    log.info("Connecting", url);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    audioSendCountRef.current = 0;

    // Connection timeout — don't let user stare at "Connecting..." for 30s
    const connectTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        log.error("Connection timed out (10s)");
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        wsRef.current = null;
        setError("Mia's kitchen is closed \u2014 the server isn't responding. Is it running?");
        setStatus("disconnected");
      }
    }, 10_000);

    ws.onopen = () => {
      clearTimeout(connectTimeout);
      if (isReconnectingRef.current) {
        log.info(`Reconnected (attempt ${reconnectAttemptsRef.current})`);
      } else {
        log.info("Connected");
      }
      reconnectAttemptsRef.current = 0;
      isReconnectingRef.current = false;
      hasEverConnectedRef.current = true;
      sessionStartTimeRef.current = Date.now();
      setStatus("connected");
    };

    ws.onclose = (e) => {
      clearTimeout(connectTimeout);
      log.info("Closed", { code: e.code, reason: e.reason });
      wsRef.current = null;
      // Server rejected the connection (e.g., invalid ID, policy violation)
      if (e.code === 1008) {
        setError(e.reason || "Connection rejected by server.");
      }
      if (!isReconnectingRef.current) {
        setStatus("disconnected");
      }
    };

    ws.onerror = () => {
      clearTimeout(connectTimeout);
      log.error("Connection error");
      setError("Someone tripped over the internet cable. Check your Wi-Fi?");
      wsRef.current = null;
      setStatus("disconnected");
    };

    const msgCounts = { total: 0, audio: 0, interrupted: 0, transcription: 0, other: 0 };
    // Per-connection diagnostic interval (closure-scoped to avoid race on reconnect)
    const localDiagInterval = setInterval(() => {
      if (msgCounts.total > 0) {
        log.debug("message counts", { ...msgCounts });
      }
    }, 5000);
    ws.addEventListener("close", () => {
      clearInterval(localDiagInterval);
    });

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        msgCounts.total++;

        // Gemini disconnected — auto-reconnect
        if (msg.type === "gemini_disconnected") {
          log.warn("Gemini disconnected — will auto-reconnect");
          onInterrupted(); // flush any queued audio from dead session

          if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
            log.error(`Max reconnect attempts reached (${MAX_RECONNECT_ATTEMPTS})`);
            setError("The connection gremlins won this round. Tap Stop, then Start to try again.");
            wsRef.current = null;
            setStatus("disconnected");
            return;
          }

          reconnectAttemptsRef.current++;
          isReconnectingRef.current = true;
          setStatus("reconnecting");
          log.info(`Reconnect attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS}`);

          // Close old WebSocket — null all handlers to prevent stale events
          if (wsRef.current) {
            wsRef.current.onmessage = null;
            wsRef.current.onclose = null;
            wsRef.current.onerror = null;
            wsRef.current.close();
            wsRef.current = null;
          }

          // Exponential backoff with ±20% jitter
          const baseDelay = BASE_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current - 1);
          const jitter = baseDelay * (0.8 + Math.random() * 0.4);
          const delay = Math.round(jitter);
          log.info(`Reconnecting in ${delay}ms`);
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connectRef.current();
          }, delay);
          return;
        }

        // AI session is live — ready to listen
        if (msg.type === "ready") {
          log.info("AI session ready");
          onReady?.();
          return;
        }

        // Custom timer events from backend (not ADK events)
        if (typeof msg.type === "string" && msg.type.startsWith("timer_")) {
          log.debug("Timer event", { type: msg.type });
          onTimerEvent?.(msg);
          return;
        }

        // Search events from backend
        if (typeof msg.type === "string" && msg.type.startsWith("search_")) {
          log.info("Search event", { type: msg.type, sourceCount: msg.sources?.length });
          onSearchEvent?.(msg as SearchEvent);
          return;
        }

        // Preference events from backend
        if (typeof msg.type === "string" && msg.type.startsWith("preference_")) {
          log.info("Preference event", { type: msg.type, key: msg.key, value: msg.value });
          onPreferenceEvent?.(msg as PreferenceEvent);
          return;
        }

        // Camera control events from backend (voice-triggered)
        if (typeof msg.type === "string" && msg.type === "camera_control") {
          log.info("Camera event", { action: msg.action });
          onCameraEvent?.(msg as CameraEvent);
          return;
        }

        const adkEvent = msg;

        // Log event structure (keys only, never full audio data)
        const keys = Object.keys(adkEvent);
        log.debug("Event received", {
          keys,
          size: event.data.length,
        });

        // Barge-in: interrupted flag in ADK event
        if (adkEvent.interrupted === true) {
          msgCounts.interrupted++;
          log.info("Barge-in: interrupted signal received");
          onInterrupted();
          // Fall through to process any remaining content in this event
        }

        // Extract audio data from event content parts
        let audioFound = false;
        if (adkEvent.content?.parts) {
          for (const part of adkEvent.content.parts) {
            if (
              part.inline_data?.mime_type?.startsWith("audio/") &&
              part.inline_data?.data
            ) {
              audioFound = true;
              msgCounts.audio++;
              log.debug("Audio extracted", {
                mimeType: part.inline_data.mime_type,
                dataSize: part.inline_data.data.length,
              });
              onAudioData(part.inline_data.data);
            }
          }
          if (!audioFound) {
            // Content parts exist but no audio — log what's in them
            const partTypes = adkEvent.content.parts.map(
              (p: Record<string, unknown>) => Object.keys(p),
            );
            log.debug("Content parts (no audio)", partTypes);
          }
        }

        // Count non-audio, non-interrupted events
        if (!audioFound && adkEvent.input_transcription?.text) {
          msgCounts.transcription++;
        } else if (!audioFound && adkEvent.output_transcription?.text) {
          msgCounts.transcription++;
        } else if (!audioFound) {
          msgCounts.other++;
        }

        // Log transcriptions (state removed — not consumed by UI)
        if (adkEvent.input_transcription?.text) {
          const text = adkEvent.input_transcription.text;
          const finished = adkEvent.input_transcription.finished;
          if (finished) {
            log.info("User said", { text });
            if (!audioFound) {
              onProcessing?.();
            } else {
              log.debug("Skipped isProcessing (audio in same event)");
            }
          } else {
            log.debug("Input transcription (partial)", { length: text.length });
          }
        }

        if (adkEvent.output_transcription?.text) {
          const text = adkEvent.output_transcription.text.replace(/<ctrl\d+>/g, '').trim();
          const finished = adkEvent.output_transcription.finished;
          if (finished) {
            log.info("Mia said", { text });
          } else {
            log.debug("Output transcription (partial)", { length: text.length });
          }
        }
      } catch (err) {
        log.error("Failed to parse event", {
          error: err,
          rawSnippet: String(event.data).slice(0, 200),
        });
      }
    };
  }, [onAudioData, onInterrupted, onTimerEvent, onSearchEvent, onPreferenceEvent, onCameraEvent, onProcessing, onReady]);
  connectRef.current = connect;

  const disconnect = useCallback(() => {
    // Cancel any pending reconnect
    isReconnectingRef.current = false;
    reconnectAttemptsRef.current = 0;
    // Clear stable user_id so next Start gets a fresh one
    userIdRef.current = null;
    hasEverConnectedRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    const durationSec = sessionStartTimeRef.current
      ? Math.round((Date.now() - sessionStartTimeRef.current) / 1000)
      : 0;
    log.info("SESSION_SUMMARY", {
      audioChunksSent: audioSendCountRef.current,
      durationSeconds: durationSec,
    });
    sessionStartTimeRef.current = 0;
    setStatus("disconnected");
  }, []);

  const safeSend = (data: string) => {
    try {
      wsRef.current?.send(data);
    } catch {
      log.warn("WebSocket send failed, dropping message");
    }
  };

  const sendAudio = useCallback((base64Data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      audioSendCountRef.current++;
      if (audioSendCountRef.current % 50 === 1) {
        log.debug(
          `Sent audio chunk #${audioSendCountRef.current} (${base64Data.length} chars b64)`,
        );
      }
      safeSend(JSON.stringify({ type: "audio", data: base64Data }));
    } else if (!isReconnectingRef.current && hasEverConnectedRef.current) {
      log.warn("Dropping audio — WebSocket not open", {
        readyState: wsRef.current?.readyState,
      });
    }
  }, []);

  const sendImage = useCallback((base64Data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      log.debug(`Sent image frame (${base64Data.length} chars b64)`);
      safeSend(JSON.stringify({ type: "image", data: base64Data }));
    }
  }, []);

  const sendCameraState = useCallback((enabled: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      log.info("Sending camera state", { enabled });
      safeSend(JSON.stringify({ type: "camera_state", enabled }));
    }
  }, []);

  const sendBargeIn = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      log.info("Sending barge-in signal to backend");
      safeSend(JSON.stringify({ type: "barge_in" }));
    }
  }, []);

  const sendTimerExpired = useCallback((timerId: string, label: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      log.info("Sending timer expired", { timerId, label });
      safeSend(
        JSON.stringify({ type: "timer_expired", timer_id: timerId, label }),
      );
    }
  }, []);

  return {
    status,
    error,
    connect,
    disconnect,
    sendAudio,
    sendImage,
    sendCameraState,
    sendBargeIn,
    sendTimerExpired,
  };
}
