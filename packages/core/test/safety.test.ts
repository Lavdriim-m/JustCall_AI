import { describe, expect, it } from "vitest";
import { detectAllergyMention, detectHumanRequest } from "../src/safety";

describe("detectAllergyMention", () => {
  const positives = [
    "Mini Tochter hät e Nussallergie",
    "Ich bin allergisch uf Nüss",
    "Hät die Pizza Nüss drin?",
    "Isch das glutenfrei?",
    "Ich bruche öppis ohni Gluten",
    "Ich han e Laktoseintoleranz",
    "Ich vertrag kei Milch",
    "Sie hät Zöliakie",
    "Gibt es eine laktosefreie Variante?",
    "Nein, aber mein Sohn hat eine Allergie",
    "allergie",
    "Unverträglichkeit uf Sellerie",
  ];
  for (const text of positives) {
    it(`detects: ${text}`, () => expect(detectAllergyMention(text).mentioned).toBe(true));
  }
  const negatives = [
    "Nei, kei Allergie",
    "Nein, keine Allergien",
    "Nein danke, niemand hat Allergien",
    "Allergie? Nei.",
    "Niemer isch allergisch",
    "Zwei Pizza Margherita bitte",
    "E Haselnuss-Glace",
    "Ohni Zwieble bitte",
    "Kei Unverträglichkeite",
  ];
  for (const text of negatives) {
    it(`ignores: ${text}`, () => expect(detectAllergyMention(text).mentioned).toBe(false));
  }
});

describe("detectHumanRequest", () => {
  it("detects explicit requests", () => {
    expect(detectHumanRequest("Chan ich mit em Chef rede?")).toBe(true);
    expect(detectHumanRequest("Ich möchte mit einem Menschen sprechen")).toBe(true);
    expect(detectHumanRequest("Verbinden Sie mich bitte mit dem Inhaber")).toBe(true);
    expect(detectHumanRequest("Ich wott kein Roboter")).toBe(true);
  });
  it("ignores normal orders", () => {
    expect(detectHumanRequest("Ich hätt gern de Chef-Salat")).toBe(false);
    expect(detectHumanRequest("Zwei Pizza Napoli bitte")).toBe(false);
  });
});
