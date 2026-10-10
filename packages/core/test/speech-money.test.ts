import { describe, expect, it } from "vitest";
import { formatChf, parseChf, spokenChf } from "../src/money";
import { canReceiveSms, formatSwissNumber, isSwissMobile, toE164 } from "../src/phone";
import { normalizeForSpeech } from "../src/speech";

describe("money", () => {
  it("formats and parses CHF", () => {
    expect(formatChf(185000)).toBe("CHF 1'850.00");
    expect(formatChf(450)).toBe("CHF 4.50");
    expect(spokenChf(1850)).toBe("18 Franken 50");
    expect(spokenChf(1200)).toBe("12 Franken");
    expect(parseChf("18.50")).toBe(1850);
    expect(parseChf("18,5")).toBe(1850);
    expect(parseChf("CHF 12.-")).toBe(1200);
    expect(parseChf("abc")).toBeNull();
  });
});

describe("phone", () => {
  it("normalises Swiss numbers", () => {
    expect(toE164("079 123 45 67")).toBe("+41791234567");
    expect(toE164("0041 44 123 45 67")).toBe("+41441234567");
    expect(toE164("+41 (0)79 123 45 67")).toBe("+41791234567");
    expect(toE164("12345")).toBeNull();
    expect(isSwissMobile("+41791234567")).toBe(true);
    expect(isSwissMobile("+41441234567")).toBe(false);
    expect(canReceiveSms("+41441234567")).toBe(false);
    expect(formatSwissNumber("+41791234567")).toBe("079 123 45 67");
  });
});

describe("normalizeForSpeech", () => {
  it("speaks prices, times and quantities naturally", () => {
    expect(normalizeForSpeech("Das macht CHF 37.50.")).toBe("Das macht 37 Franken 50.");
    expect(normalizeForSpeech("Total 42.00 CHF")).toBe("Total 42 Franken");
    expect(normalizeForSpeech("Abholung um 18:30 Uhr")).toBe("Abholung um 18 Uhr 30");
    expect(normalizeForSpeech("Abholung um 19:00")).toBe("Abholung um 19 Uhr");
    expect(normalizeForSpeech("2x Pizza Napoli [I3]")).toBe("2 mal Pizza Napoli");
    expect(normalizeForSpeech("**Ja** - gerne, ca. 20 Min.")).toBe("Ja, gerne, circa 20 Minuten");
  });
});
