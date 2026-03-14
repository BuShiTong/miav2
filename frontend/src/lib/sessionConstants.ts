import type { ButtonState } from "../App";

export const VOICE_RING: Record<ButtonState, string> = {
  idle: "voice-ring voice-ring--idle",
  connecting: "voice-ring voice-ring--connecting",
  reconnecting: "voice-ring voice-ring--reconnecting",
  listening: "voice-ring voice-ring--listening",
  speaking: "voice-ring voice-ring--speaking",
  searching: "voice-ring voice-ring--searching",
  processing: "voice-ring voice-ring--processing",
};

export const BUTTON_LABEL: Record<ButtonState, string> = {
  idle: "Start",
  connecting: "Connecting...",
  reconnecting: "Reconnecting...",
  listening: "Listening...",
  speaking: "Speaking...",
  searching: "Searching...",
  processing: "Processing...",
};

export const SR_ANNOUNCEMENT: Record<ButtonState, string> = {
  idle: "",
  connecting: "Connecting to AI",
  reconnecting: "Reconnecting to AI",
  listening: "AI is listening",
  speaking: "AI is speaking",
  searching: "Searching the web",
  processing: "AI is processing",
};
