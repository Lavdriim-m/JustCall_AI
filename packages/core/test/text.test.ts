import { describe, expect, it } from "vitest";
import { SentenceStream, normalize, slugify, tokenize, tokenSimilarity } from "../src/text";

describe("normalize", () => {
  it("removes diacritics, ß and punctuation", () => {
    expect(normalize("Dürüm-Kebab, grösser!")).toBe("durum kebab grosser");
    expect(normalize("Strasse ß")).toBe("strasse ss");
  });
  it("maps Swiss German number words", () => {
    expect(tokenize("Menü drü")).toEqual(["menu", "3"]);
    expect(tokenize("zwöi Pizza")).toEqual(["2", "pizza"]);
  });
  it("drops stopwords on request", () => {
    expect(tokenize("ich hätt gern e Margherita bitte", { dropStopwords: true })).toEqual([
      "margherita",
    ]);
  });
});

describe("tokenSimilarity", () => {
  it("tolerates transcription errors", () => {
    expect(tokenSimilarity("margarita", "margherita")).toBeGreaterThan(0.8);
    expect(tokenSimilarity("durum", "duerum")).toBeGreaterThan(0.7);
  });
  it("is strict for numbers and short tokens", () => {
    expect(tokenSimilarity("3", "4")).toBe(0);
    expect(tokenSimilarity("cola", "zola")).toBe(0);
  });
});

describe("SentenceStream", () => {
  it("emits complete sentences and keeps decimals together", () => {
    const s = new SentenceStream();
    expect(s.push("Das macht 18.50 Franken. Darf es")).toEqual(["Das macht 18.50 Franken."]);
    expect(s.push(" noch etwas sein? Ja")).toEqual(["Darf es noch etwas sein?"]);
    expect(s.flush()).toBe("Ja");
  });
  it("does not split on abbreviations", () => {
    const s = new SentenceStream();
    expect(s.push("Das ist ca. 20 Minuten. Gut")).toEqual(["Das ist ca. 20 Minuten."]);
  });
});

describe("slugify", () => {
  it("creates url friendly slugs", () => {
    expect(slugify("Pizzeria Bella Vista Zürich")).toBe("pizzeria-bella-vista-zurich");
  });
});
