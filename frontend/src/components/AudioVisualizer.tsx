import { type MutableRefObject, useEffect, useRef } from "react";

const BAR_COUNT = 5;
const BAR_WEIGHTS = [0.6, 0.8, 1.0, 0.8, 0.6]; // center-weighted
const STATIC_HEIGHT = 0.3; // fallback for reduced-motion or idle

interface AudioVisualizerProps {
  micRmsRef: MutableRefObject<number>;
  analyserRef: MutableRefObject<AnalyserNode | null>;
  isPlaying: boolean;
}

export function AudioVisualizer({ micRmsRef, analyserRef, isPlaying }: AudioVisualizerProps) {
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number>(0);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = mq.matches;
    const handler = (e: MediaQueryListEvent) => { reducedMotionRef.current = e.matches; };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const freqData = new Uint8Array(32); // fftSize 64 → 32 bins

    const animate = () => {
      const bars = barsRef.current;

      if (reducedMotionRef.current) {
        for (let i = 0; i < BAR_COUNT; i++) {
          const bar = bars[i];
          if (bar) bar.style.transform = `scaleY(${STATIC_HEIGHT})`;
        }
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      let heights: number[];

      if (isPlaying && analyserRef.current) {
        // Speaking: read frequency data from playback AnalyserNode
        analyserRef.current.getByteFrequencyData(freqData);
        // Average groups of bins for each bar
        const binsPerBar = Math.floor(freqData.length / BAR_COUNT);
        heights = [];
        for (let i = 0; i < BAR_COUNT; i++) {
          let sum = 0;
          for (let j = 0; j < binsPerBar; j++) {
            sum += freqData[i * binsPerBar + j];
          }
          const avg = sum / binsPerBar / 255; // normalize to 0-1
          heights.push(Math.max(0.08, avg * BAR_WEIGHTS[i]));
        }
      } else {
        // Listening/idle: use mic RMS
        const rms = micRmsRef.current;
        const normalized = Math.min(rms / 0.15, 1); // 0.15 RMS = full height
        heights = BAR_WEIGHTS.map(w => Math.max(0.08, normalized * w));
      }

      for (let i = 0; i < BAR_COUNT; i++) {
        const bar = bars[i];
        if (bar) bar.style.transform = `scaleY(${heights[i]})`;
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, analyserRef, micRmsRef]);

  return (
    <div className="viz-bars" aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <div
          key={i}
          className="viz-bar"
          ref={el => { barsRef.current[i] = el; }}
        />
      ))}
    </div>
  );
}
