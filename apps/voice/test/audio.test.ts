import { describe, expect, it } from "vitest";
import {
  frames,
  mulawToPcm16,
  pcm16ToMulaw,
  pcm16ToWav,
  resamplePcm16,
  rms,
} from "../src/audio/codec";
import { EnergyVad } from "../src/audio/vad";

function sine(freq: number, rate: number, ms: number, amp = 8000): Buffer {
  const n = Math.round((rate * ms) / 1000);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(Math.round(amp * Math.sin((2 * Math.PI * freq * i) / rate)), i * 2);
  return b;
}

describe("μ-law codec", () => {
  it("round-trips with small error", () => {
    const pcm = sine(440, 8000, 100);
    const back = mulawToPcm16(pcm16ToMulaw(pcm));
    let maxErr = 0;
    for (let i = 0; i < pcm.length / 2; i++)
      maxErr = Math.max(maxErr, Math.abs(pcm.readInt16LE(i * 2) - back.readInt16LE(i * 2)));
    expect(maxErr).toBeLessThan(400);
  });
  it("encodes silence as 0xFF", () => {
    expect(pcm16ToMulaw(Buffer.alloc(4))[0]).toBe(0xff);
  });
});

describe("resampling", () => {
  it("downsamples 24 kHz to 8 kHz keeping the level", () => {
    const pcm = sine(300, 24000, 200);
    const out = resamplePcm16(pcm, 24000, 8000);
    expect(out.length / 2).toBe(1600);
    expect(Math.abs(rms(out) - rms(pcm)) / rms(pcm)).toBeLessThan(0.1);
  });
});

describe("helpers", () => {
  it("creates WAV headers and frames", () => {
    const wav = pcm16ToWav(Buffer.alloc(320), 8000);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.length).toBe(364);
    expect([...frames(Buffer.alloc(400))].map((f) => f.length)).toEqual([160, 160, 160]);
  });
});

describe("EnergyVad", () => {
  it("detects an utterance between silences", () => {
    const vad = new EnergyVad({ endSilenceMs: 200 });
    const silence = pcm16ToMulaw(Buffer.alloc(320));
    const speech = pcm16ToMulaw(sine(300, 8000, 20, 9000));
    const events = [];
    for (let i = 0; i < 10; i++) events.push(...vad.push(silence));
    for (let i = 0; i < 30; i++) events.push(...vad.push(speech));
    for (let i = 0; i < 15; i++) events.push(...vad.push(silence));
    expect(events.map((e) => e.type)).toEqual(["speech_start", "speech_end"]);
    const end = events[1] as { durationMs: number };
    expect(end.durationMs).toBeGreaterThan(500);
  });
});
