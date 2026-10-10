import { describe, expect, it } from "vitest";
import { demoMenu } from "../src/fixtures/demo";
import { MenuIndex } from "../src/menu/menu-index";
import { formatMenuForPrompt } from "../src/menu/format";

const index = new MenuIndex(demoMenu);
const nameOf = (q: string) => {
  const m = index.matchItem(q);
  return m.status === "exact" || m.status === "confident" ? m.item.name : m.status;
};

describe("MenuIndex.matchItem", () => {
  it("resolves aliases to the same item (Combo 3 = Pizza Napoli)", () => {
    expect(nameOf("Combo 3")).toBe("Pizza Napoli");
    expect(nameOf("combo drei")).toBe("Pizza Napoli");
    expect(nameOf("Napoli")).toBe("Pizza Napoli");
    expect(nameOf("Pizza Napoli")).toBe("Pizza Napoli");
  });
  it("resolves menu codes", () => {
    expect(nameOf("Nummer 3")).toBe("Pizza Napoli");
    expect(nameOf("Nr. 5")).toBe("Diavola");
    expect(nameOf("M1")).toBe("Kebab-Menü");
  });
  it("resolves short references", () => {
    const ref = index.refForItem("item-diavola");
    expect(nameOf(ref)).toBe("Diavola");
  });
  it("is tolerant to transcription errors and dialect", () => {
    expect(nameOf("Margarita")).toBe("Margherita");
    expect(nameOf("Margeritta")).toBe("Margherita");
    expect(nameOf("Durum")).toBe("Dürüm Kebab");
    expect(nameOf("quatro formagi")).toBe("Quattro Formaggi");
    expect(nameOf("es Cola")).toBe("Coca-Cola 0.5l");
    expect(nameOf("cola zero")).toBe("Coca-Cola Zero 0.5l");
    expect(nameOf("spaghetti bolo")).toBe("Spaghetti Bolognese");
    expect(nameOf("tiramisu")).toBe("Tiramisu");
  });
  it("uses aliases defined by the restaurant for generic words", () => {
    expect(nameOf("Kebab")).toBe("Döner Kebab im Fladenbrot");
  });
  it("reports ambiguity for generic words", () => {
    const m = index.matchItem("Pizza");
    expect(["ambiguous", "none"]).toContain(m.status);
  });
  it("reports unknown items", () => {
    expect(index.matchItem("Sushi").status).toBe("none");
  });
});

describe("MenuIndex.matchOption", () => {
  const napoli = demoMenu.items.find((i) => i.id === "item-napoli")!;
  it("matches option names and aliases", () => {
    const m = index.matchOption(napoli, "extra Käse");
    expect(m.status === "matched" && m.option.name).toBe("Extra Mozzarella");
    const g = index.matchOption(napoli, "gross");
    expect(g.status === "matched" && g.option.name).toBe("Gross");
  });
  it("does not match options of other items", () => {
    expect(index.matchOption(napoli, "Cocktailsauce").status).toBe("none");
  });
});

describe("formatMenuForPrompt", () => {
  it("lists groups once and items with references and aliases", () => {
    const text = formatMenuForPrompt(index);
    expect(text).toContain("## Optionsgruppen");
    expect(text).toMatch(/\[I\d+\] Pizza Napoli \| 18\.50 \| auch genannt: Napoli, Combo 3/);
    expect(text).toContain("Grösse (Pflicht, genau 1)");
    expect(text.match(/Optionsgruppen/g)?.length).toBe(1);
  });
});
