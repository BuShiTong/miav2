/**
 * AudioWorklet processor for streaming audio playback.
 * Uses a queue of Float32Array chunks consumed in order.
 * Outputs silence on underrun (no glitches).
 */
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = []; // Array of Float32Arrays
    this.currentBuffer = null;
    this.currentOffset = 0;

    // --- Diagnostics ---
    this.totalReceived = 0;
    this.totalSamplesConsumed = 0;
    this.underrunSamples = 0;
    this.capHits = 0;
    this.queueHighWater = 0;
    this.processCount = 0;
    this.heartbeatCount = 0;

    this.port.onmessage = (event) => {
      // Flush command: clear all queued audio immediately
      if (event.data === "flush") {
        this.queue = [];
        this.currentBuffer = null;
        this.currentOffset = 0;
        return;
      }
      // Audio data: cap at 1000 chunks (~40s at 960 samples/chunk) to prevent memory buildup
      if (this.queue.length >= 1000) {
        this.queue.shift();
        this.capHits++;
      }
      this.totalReceived++;
      this.queue.push(event.data);
      if (this.queue.length > this.queueHighWater) {
        this.queueHighWater = this.queue.length;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;

    const channel = output[0];

    for (let i = 0; i < channel.length; i++) {
      if (this.currentBuffer && this.currentOffset < this.currentBuffer.length) {
        channel[i] = this.currentBuffer[this.currentOffset++];
        this.totalSamplesConsumed++;
      } else if (this.queue.length > 0) {
        this.currentBuffer = this.queue.shift();
        this.currentOffset = 0;
        channel[i] = this.currentBuffer[this.currentOffset++];
        this.totalSamplesConsumed++;
      } else {
        channel[i] = 0; // underrun: silence
        this.underrunSamples++;
      }
    }

    // Heartbeat: signal main thread that audio is still playing (~250ms interval)
    this.heartbeatCount++;
    if (this.heartbeatCount >= 47) { // ~250ms at 24kHz/128 samples
      this.heartbeatCount = 0;
      const hasAudio = this.queue.length > 0 ||
        (this.currentBuffer && this.currentOffset < this.currentBuffer.length);
      if (hasAudio) {
        this.port.postMessage({ type: "playback_active" });
      }
    }

    // Report diagnostics every ~1 second (188 calls at 24kHz/128 samples)
    this.processCount++;
    if (this.processCount >= 188) {
      this.port.postMessage({
        type: "diag",
        queueLen: this.queue.length,
        queueHighWater: this.queueHighWater,
        received: this.totalReceived,
        consumed: this.totalSamplesConsumed,
        underruns: this.underrunSamples,
        capHits: this.capHits,
        processRate: this.processCount,
      });
      this.queueHighWater = this.queue.length;
      this.processCount = 0;
    }

    return true;
  }
}

registerProcessor("playback-processor", PlaybackProcessor);
