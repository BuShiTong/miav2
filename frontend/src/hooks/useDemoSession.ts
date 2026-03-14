import { useCallback, useEffect, useRef, useState } from "react";
import type { ButtonState } from "../App";
import type { Timer } from "./useTimers";
import type { Preferences } from "./usePreferences";

const CYCLE_STATES: ButtonState[] = ["listening", "speaking", "searching", "processing"];
const CYCLE_INTERVAL_MS = 3000;

const DEMO_PREFERENCES: Preferences = {
  allergies: "tree nuts",
  dietary: "vegetarian",
  skill_level: "intermediate",
};

function createDemoTimers(): Timer[] {
  const now = Date.now();
  return [
    {
      id: "demo-1",
      label: "Pasta",
      targetTime: now + 480_000,
      durationSeconds: 480,
      remainingSeconds: 480,
      expired: false,
      paused: false,
      hidden: false,
    },
    {
      id: "demo-2",
      label: "Garlic bread",
      targetTime: now + 45_000,
      durationSeconds: 45,
      remainingSeconds: 45,
      expired: false,
      paused: true,
      hidden: false,
    },
  ];
}

const VOICE_RING: Record<ButtonState, string> = {
  idle: "voice-ring voice-ring--idle",
  connecting: "voice-ring voice-ring--connecting",
  reconnecting: "voice-ring voice-ring--reconnecting",
  listening: "voice-ring voice-ring--listening",
  speaking: "voice-ring voice-ring--speaking",
  searching: "voice-ring voice-ring--searching",
  processing: "voice-ring voice-ring--processing",
};

const BUTTON_LABEL: Record<ButtonState, string> = {
  idle: "Start",
  connecting: "Connecting...",
  reconnecting: "Reconnecting...",
  listening: "Listening...",
  speaking: "Speaking...",
  searching: "Searching...",
  processing: "Processing...",
};

const SR_ANNOUNCEMENT: Record<ButtonState, string> = {
  idle: "",
  connecting: "Connecting to AI",
  reconnecting: "Reconnecting to AI",
  listening: "AI is listening",
  speaking: "AI is speaking",
  searching: "Searching the web",
  processing: "AI is processing",
};

export function useDemoSession() {
  const [buttonState, setButtonState] = useState<ButtonState>("listening");
  const [timers, setTimers] = useState<Timer[]>(createDemoTimers);

  const micRmsRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Cycle through button states
  useEffect(() => {
    let index = 0;
    const id = setInterval(() => {
      index = (index + 1) % CYCLE_STATES.length;
      setButtonState(CYCLE_STATES[index]);
    }, CYCLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Tick non-paused timers every second
  useEffect(() => {
    const id = setInterval(() => {
      setTimers((prev) =>
        prev.map((t) => {
          if (t.paused || t.expired) return t;
          const remaining = Math.max(0, Math.round((t.targetTime - Date.now()) / 1000));
          return {
            ...t,
            remainingSeconds: remaining,
            expired: remaining === 0,
          };
        }),
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const voiceRingClass = VOICE_RING[buttonState];
  const buttonLabel = BUTTON_LABEL[buttonState];
  const srAnnouncement = SR_ANNOUNCEMENT[buttonState];

  const noop = useCallback(() => {}, []);

  return {
    buttonState,
    voiceRingClass,
    buttonLabel,
    srAnnouncement,
    isConnected: true,
    isConnecting: false,
    isReconnecting: false,
    isSearching: buttonState === "searching",
    isPlaying: buttonState === "speaking",
    timers,
    preferences: DEMO_PREFERENCES,
    micError: null,
    cameraError: null,
    wsError: null,
    micRmsRef,
    analyserRef,
    onFlipCamera: noop,
  };
}
