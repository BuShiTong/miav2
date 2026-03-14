import { useCallback, useRef } from "react";
import { createLogger } from "../lib/logger";

const log = createLogger("VideoCapture");

interface UseVideoCaptureOptions {
  onFrame: (base64Jpeg: string) => void;
}

export function useVideoCapture({ onFrame }: UseVideoCaptureOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const isFlippingRef = useRef(false);
  const facingModeRef = useRef<"environment" | "user">("environment");
  const frameCountRef = useRef(0);

  const startCapture = useCallback(
    async (
      videoElement: HTMLVideoElement,
      facingMode: "environment" | "user"
    ): Promise<"granted" | "denied"> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 768 },
            height: { ideal: 768 },
            frameRate: { ideal: 1 },
            facingMode: { ideal: facingMode },
          },
        });
        streamRef.current = stream;
        videoRef.current = videoElement;

        videoElement.srcObject = stream;
        await videoElement.play();

        // Create an offscreen canvas for JPEG encoding
        if (!canvasRef.current) {
          const canvas = document.createElement("canvas");
          canvas.width = 768;
          canvas.height = 768;
          canvasRef.current = canvas;
        }

        isRunningRef.current = true;

        // Capture a frame every 1 second
        if (intervalRef.current !== null) {
          clearInterval(intervalRef.current);
        }
        intervalRef.current = window.setInterval(() => {
          if (!videoRef.current || !canvasRef.current) return;

          const ctx = canvasRef.current.getContext("2d");
          if (!ctx) return;

          // Draw the video frame, scaled to 768x768
          const video = videoRef.current;
          const size = Math.min(video.videoWidth, video.videoHeight);
          const sx = (video.videoWidth - size) / 2;
          const sy = (video.videoHeight - size) / 2;
          ctx.drawImage(video, sx, sy, size, size, 0, 0, 768, 768);

          canvasRef.current.toBlob(
            (blob) => {
              if (!blob || !isRunningRef.current) return;
              const reader = new FileReader();
              reader.onloadend = () => {
                if (!isRunningRef.current) return;
                const result = reader.result as string;
                // Strip the data URL prefix to get pure base64
                const base64 = result.split(",")[1];
                if (base64) {
                  onFrame(base64);
                  frameCountRef.current++;
                  if (frameCountRef.current % 30 === 1) {
                    log.info("Camera frames sent", { total: frameCountRef.current });
                  }
                }
              };
              reader.readAsDataURL(blob);
            },
            "image/jpeg",
            0.4
          );
        }, 1000);

        return "granted";
      } catch {
        log.warn("Camera access denied or failed");
        return "denied";
      }
    },
    [onFrame]
  );

  const start = useCallback(
    async (videoElement: HTMLVideoElement): Promise<"granted" | "denied"> => {
      facingModeRef.current = "user";
      return startCapture(videoElement, "user");
    },
    [startCapture]
  );

  const stop = useCallback(() => {
    isRunningRef.current = false;
    if (frameCountRef.current > 0) {
      log.info("Camera stopped", { totalFramesSent: frameCountRef.current });
    }
    frameCountRef.current = 0;
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    videoRef.current = null;
    canvasRef.current = null;
  }, []);

  const flip = useCallback(async () => {
    if (!videoRef.current || !isRunningRef.current || isFlippingRef.current) return;
    isFlippingRef.current = true;

    try {
      const videoElement = videoRef.current;
      const newMode = facingModeRef.current === "environment" ? "user" : "environment";

      // Stop current stream tracks (keep refs alive)
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      facingModeRef.current = newMode;
      const result = await startCapture(videoElement, newMode);
      if (result === "denied") {
        // Revert to previous mode
        facingModeRef.current = newMode === "environment" ? "user" : "environment";
        log.warn("Camera flip failed, reverting");
        const fallback = await startCapture(videoElement, facingModeRef.current);
        if (fallback === "denied") {
          log.error("Camera flip fallback also failed");
          return "denied" as const;
        }
      } else {
        log.info("Camera flipped to", { facingMode: newMode });
      }
    } finally {
      isFlippingRef.current = false;
    }
  }, [startCapture]);

  return { start, stop, flip };
}
