/** Browser-side μ-law codec and resampling (mirrors the phone line: 8 kHz μ-law). */

const BIAS = 0x84;
const CLIP = 32635;

export function encodeMulaw(sample: number): number {
  let s = Math.max(-CLIP, Math.min(CLIP, sample));
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

const DECODE = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  DECODE[i] = (sign ? -sample : sample) / 32768;
}

export function decodeMulaw(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = DECODE[bytes[i]!]!;
  return out;
}

/** Downsamples float audio to 8 kHz and encodes μ-law. Keeps fractional state between calls. */
export class Downsampler {
  private pos = 0;
  private acc = 0;
  private n = 0;
  constructor(private readonly inputRate: number) {}

  process(input: Float32Array): Uint8Array {
    const ratio = this.inputRate / 8000;
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      this.acc += input[i]!;
      this.n += 1;
      this.pos += 1;
      if (this.pos >= ratio) {
        this.pos -= ratio;
        out.push(encodeMulaw(Math.round((this.acc / this.n) * 32767)));
        this.acc = 0;
        this.n = 0;
      }
    }
    return Uint8Array.from(out);
  }
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const CAPTURE_WORKLET = `
class JcCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("jc-capture", JcCapture);
`;
