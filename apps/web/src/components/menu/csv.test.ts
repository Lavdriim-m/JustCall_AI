import { describe, expect, it } from "vitest";
import { parseMenuCsv } from "./csv";

describe("parseMenuCsv", () => {
  it("parses quoted fields, aliases and option groups", () => {
    const menu = parseMenuCsv(
      [
        "category,name,price,code,aliases,description,options",
        'Pizza,Pizza Napoli,18.50,3,Napoli|Combo 3,"Tomaten, Mozzarella, Sardellen",Grösse|Pizza-Extras',
        "Pizza,Margherita,16,1,,,Grösse",
        'Getränke,Coca-Cola 0.5l,"4,50",,Cola|Coke,,',
      ].join("\n"),
    );
    expect(menu.categories.map((c) => c.name)).toEqual(["Pizza", "Getränke"]);
    const napoli = menu.categories[0]!.items[0]!;
    expect(napoli).toMatchObject({
      name: "Pizza Napoli",
      priceCents: 1850,
      code: "3",
      aliases: ["Napoli", "Combo 3"],
      optionGroups: ["Grösse", "Pizza-Extras"],
    });
    expect(napoli.description).toBe("Tomaten, Mozzarella, Sardellen");
    expect(menu.categories[1]!.items[0]!.priceCents).toBe(450);
  });

  it("supports semicolon separated files from Excel", () => {
    const menu = parseMenuCsv("category;name;price\nPasta;Lasagne;19.00");
    expect(menu.categories[0]!.items[0]).toMatchObject({ name: "Lasagne", priceCents: 1900 });
  });

  it("reports missing columns", () => {
    expect(() => parseMenuCsv("name,price\nX,1")).toThrow(/category/);
  });
});
