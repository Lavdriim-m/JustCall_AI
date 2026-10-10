/**
 * G.711 μ-law codec and small DSP helpers. Telephony audio (Twilio Media Streams) is 8 kHz mono
 * μ-law in 20 ms frames of 160 bytes.
 */

const BIAS = 0x84;
const CLIP = 32635;

const DECODE_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  DECODE_TABLE[i] = sign ? -sample : sample;
}

function encodeSample(sample: number): number {
  let s = Math.max(-CLIP, Math.min(CLIP, sample));
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export const MULAW_SILENCE = 0xff;
export const FRAME_BYTES = 160; // 20 ms at 8 kHz

/** μ-law bytes → 16-bit PCM little endian. */
export function mulawToPcm16(mulaw: Uint8Array): Buffer {
  const out = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) out.writeInt16LE(DECODE_TABLE[mulaw[i]!]!, i * 2);
  return out;
}

/** 16-bit PCM little endian → μ-law bytes. */
export function pcm16ToMulaw(pcm: Buffer): Buffer {
  const samples = Math.floor(pcm.length / 2);
  const out = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) out[i] = encodeSample(pcm.readInt16LE(i * 2));
  return out;
}

/**
 * Resamples 16-bit PCM by linear interpolation with a simple moving-average low-pass when
 * downsampling. Good enough for speech on the phone (8 kHz).
 */
export function resamplePcm16(pcm: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) return pcm;
  const input = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  let source: Int16Array | Float32Array = input;
  if (toRate < fromRate) {
    const window = Math.max(1, Math.round(fromRate / toRate));
    const filtered = new Float32Array(input.length);
    let acc = 0;
    for (let i = 0; i < input.length; i++) {
      acc += input[i]!;
      if (i >= window) acc -= input[i - window]!;
      filtered[i] = acc / Math.min(i + 1, window);
    }
    source = filtered;
  }
  const ratio = fromRate / toRate;
  const outLength = Math.floor(source.length / ratio);
  const out = Buffer.alloc(outLength * 2);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = source[idx] ?? 0;
    const b = source[idx + 1] ?? a;
    const v = Math.round(a + (b - a) * frac);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, v)), i * 2);
  }
  return out;
}

/** Root-mean-square level of 16-bit PCM (0..32768). */
export function rms(pcm: Buffer): number {
  const samples = Math.floor(pcm.length / 2);
  if (!samples) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = pcm.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}

/** Wraps 16-bit mono PCM in a WAV container. */
export function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Splits a μ-law buffer into 20 ms frames (the last frame is padded with silence). */
export function* frames(mulaw: Buffer, frameBytes = FRAME_BYTES): Generator<Buffer> {
  for (let i = 0; i < mulaw.length; i += frameBytes) {
    const chunk = mulaw.subarray(i, i + frameBytes);
    if (chunk.length === frameBytes) yield chunk;
    else {
      const padded = Buffer.alloc(frameBytes, MULAW_SILENCE);
      chunk.copy(padded);
      yield padded;
    }
  }
}
