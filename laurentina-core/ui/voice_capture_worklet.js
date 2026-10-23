/* Local PCM only. Audio is consumed in memory by the main renderer. */
class LaurentinaCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(1024); this.offset = 0; }
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (input) for (const sample of input) {
      this.buffer[this.offset++] = sample;
      if (this.offset === this.buffer.length) { this.port.postMessage(this.buffer); this.offset = 0; }
    }
    for (const output of outputs) for (const channel of output) channel.fill(0);
    return true;
  }
}
registerProcessor('laurentina-capture', LaurentinaCapture);
