/**
 * Source of the AudioWorkletProcessor, as a string. It is loaded from a Blob
 * URL so the npm package does not have to ship and serve a separate file.
 *
 * Converts Float32 mic samples to Int16 and resamples to 24 kHz when the
 * context is not already running at 24 kHz. Chromium honours
 * `AudioContext({ sampleRate: 24000 })`; Firefox and Safari do not, so the
 * resampler is what makes those browsers work. (Live docs, 2026-09-11.)
 */
export const PCM_WORKLET_SOURCE = `
class PointtoPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.target = 24000;
    this.ratio = sampleRate / this.target;
    this.carry = new Float32Array(0);
    this.pos = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;

    let samples;
    if (this.ratio === 1) {
      samples = ch;
    } else {
      // Linear resample. Good enough for speech; keeps the worklet tiny.
      const src = new Float32Array(this.carry.length + ch.length);
      src.set(this.carry, 0);
      src.set(ch, this.carry.length);
      const outLen = Math.floor((src.length - 1 - this.pos) / this.ratio);
      samples = new Float32Array(Math.max(outLen, 0));
      let p = this.pos;
      for (let i = 0; i < outLen; i++) {
        const idx = Math.floor(p);
        const frac = p - idx;
        samples[i] = src[idx] * (1 - frac) + src[idx + 1] * frac;
        p += this.ratio;
      }
      const consumed = Math.floor(p);
      this.carry = src.slice(consumed);
      this.pos = p - consumed;
    }

    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}
registerProcessor('pointto-pcm', PointtoPcmProcessor);
`;
