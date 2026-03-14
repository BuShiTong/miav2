/**
 * AudioWorklet processor for microphone capture.
 * Buffers 640 samples (~40ms at 16kHz) before posting to main thread.
 * Vertex best practices recommend 20-40ms chunks — this gives ~25 messages/sec.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(640); // 40ms at 16kHz
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    let srcOffset = 0;
    while (srcOffset < input.length) {
      const space = this.buffer.length - this.offset;
      const toCopy = Math.min(input.length - srcOffset, space);
      this.buffer.set(input.subarray(srcOffset, srcOffset + toCopy), this.offset);
      this.offset += toCopy;
      srcOffset += toCopy;

      if (this.offset >= this.buffer.length) {
        this.port.postMessage(new Float32Array(this.buffer));
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
