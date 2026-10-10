import { describe, expect, it } from "vitest";
import { Cart, lineTotal } from "../src/cart";
import { demoMenu } from "../src/fixtures/demo";
import { MenuIndex } from "../src/menu/menu-index";

const index = new MenuIndex(demoMenu);
const newCart = () => new Cart(index, 20);

describe("Cart", () => {
  it("adds items with default options and computes prices server-side", () => {
    const cart = newCart();
    const r = cart.add({ item: "Napoli", quantity: 2 });
    expect(r.status).toBe("added");
    expect(cart.items[0]!.options.map((o) => o.optionName)).toEqual(["Normal"]);
    expect(cart.subtotalCents).toBe(2 * 1850);
  });

  it("applies option surcharges", () => {
    const cart = newCart();
    cart.add({ item: "Combo 3", quantity: 1, options: ["gross", "extra Käse"] });
    const line = cart.items[0]!;
    expect(line.name).toBe("Pizza Napoli");
    expect(line.options.map((o) => o.optionName)).toEqual(["Gross", "Extra Mozzarella"]);
    expect(lineTotal(line)).toBe(1850 + 500 + 200);
  });

  it("asks for required choices without defaults", () => {
    const cart = newCart();
    const r = cart.add({ item: "Kebab-Menü" });
    expect(r.status).toBe("needs_choice");
    if (r.status === "needs_choice") {
      expect(r.missing[0]!.group).toBe("Menü-Getränk");
      expect(r.missing[0]!.choices).toContain("Fanta 0.5l");
    }
    expect(cart.isEmpty).toBe(true);
    const ok = cart.add({ item: "Kebab-Menü", options: ["Rivella", "Cocktail"] });
    expect(ok.status).toBe("added");
    expect(cart.items[0]!.options.map((o) => o.optionName)).toEqual(["Cocktailsauce", "Rivella Rot 0.5l"]);
  });

  it("keeps the last mention in single-choice groups", () => {
    const cart = newCart();
    cart.add({ item: "Margherita", options: ["klein", "gross"] });
    expect(cart.items[0]!.options.map((o) => o.optionName)).toEqual(["Gross"]);
  });

  it("merges identical lines", () => {
    const cart = newCart();
    cart.add({ item: "Cola" });
    const r = cart.add({ item: "Coca Cola", quantity: 2 });
    expect(r.status === "added" && r.merged).toBe(true);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.quantity).toBe(3);
  });

  it("rejects unknown options and sold out items", () => {
    const cart = newCart();
    expect(cart.add({ item: "Margherita", options: ["Trüffel"] }).status).toBe("invalid_option");
    const soldOut = new MenuIndex({
      ...demoMenu,
      items: demoMenu.items.map((i) => (i.id === "item-tiramisu" ? { ...i, isAvailable: false } : i)),
    });
    expect(new Cart(soldOut).add({ item: "Tiramisu" }).status).toBe("unavailable");
  });

  it("validates quantities", () => {
    const cart = newCart();
    expect(cart.add({ item: "Cola", quantity: 0 }).status).toBe("invalid_quantity");
    expect(cart.add({ item: "Cola", quantity: 21 }).status).toBe("invalid_quantity");
  });

  it("updates options without resetting other groups", () => {
    const cart = newCart();
    cart.add({ item: "Diavola", options: ["gross"] });
    const before = cart.version;
    const r = cart.update("L1", { options: ["Oliven"] });
    expect(r.ok).toBe(true);
    expect(cart.items[0]!.options.map((o) => o.optionName)).toEqual(["Gross", "Oliven"]);
    expect(cart.version).toBeGreaterThan(before);
    cart.update("l1", { quantity: 3 });
    expect(cart.items[0]!.quantity).toBe(3);
    cart.update("L1", { quantity: 0 });
    expect(cart.isEmpty).toBe(true);
  });

  it("summarises lines with prices", () => {
    const cart = newCart();
    cart.add({ item: "Margherita", quantity: 2 });
    cart.add({ item: "Cola" });
    expect(cart.summary()).toBe("L1: 2x Margherita (Normal) = CHF 32.00\nL2: 1x Coca-Cola 0.5l = CHF 4.50");
    expect(cart.subtotalCents).toBe(3650);
  });
});
