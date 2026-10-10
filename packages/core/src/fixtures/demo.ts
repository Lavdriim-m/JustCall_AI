/**
 * Demo restaurant used by unit tests, the evaluation harness and the database seed.
 * IDs are stable strings here; the seed script replaces them with UUIDs.
 */
import type { RestaurantProfile } from "../conversation/types";
import type { MenuSnapshot } from "../menu/types";

export const demoRestaurant: RestaurantProfile = {
  id: "demo-restaurant",
  name: "Pizzeria Bella Vista",
  botName: "Lea",
  speechStyle: "swiss_standard",
  greeting: null,
  customInstructions: "Grosse Pizzen haben 40 cm Durchmesser. Unser Bestseller ist die Diavola.",
  timezone: "Europe/Zurich",
  street: "Langstrasse 120",
  postalCode: "8004",
  city: "Zürich",
  publicPhone: "+41441234567",
  acceptingOrders: true,
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryFeeCents: 500,
  deliveryMinOrderCents: 3000,
  deliveryPostalCodes: ["8004", "8005", "8003"],
  prepTimeMinutes: 20,
  deliveryTimeMinutes: 45,
  extraWaitMinutes: 0,
  allowPreorders: true,
  maxItemQuantity: 20,
  openingHours: {
    mon: [
      { open: "11:00", close: "14:00" },
      { open: "17:00", close: "22:30" },
    ],
    tue: [
      { open: "11:00", close: "14:00" },
      { open: "17:00", close: "22:30" },
    ],
    wed: [
      { open: "11:00", close: "14:00" },
      { open: "17:00", close: "22:30" },
    ],
    thu: [
      { open: "11:00", close: "14:00" },
      { open: "17:00", close: "22:30" },
    ],
    fri: [
      { open: "11:00", close: "14:00" },
      { open: "17:00", close: "02:00" },
    ],
    sat: [{ open: "17:00", close: "02:00" }],
    sun: [{ open: "17:00", close: "22:00" }],
  },
  hoursExceptions: [{ date: "2026-12-25", ranges: [], note: "Weihnachten" }],
  paymentMethods: ["cash", "twint"],
  twintPaymentUrl: null,
  paymentNote: null,
  allergyQuestionEnabled: true,
  transferPhone: "+41791112233",
  transferOnAllergy: true,
  transferOnOwnerRequest: true,
  smsEnabled: true,
};

type GroupDef = MenuSnapshot["groups"][number];
type ItemDef = MenuSnapshot["items"][number];

const opt = (
  id: string,
  name: string,
  priceDeltaCents = 0,
  aliases: string[] = [],
  extra: Partial<GroupDef["options"][number]> = {},
): GroupDef["options"][number] => ({
  id,
  name,
  aliases,
  priceDeltaCents,
  isDefault: false,
  isAvailable: true,
  sortOrder: 0,
  ...extra,
});

export const demoMenu: MenuSnapshot = {
  categories: [
    { id: "cat-pizza", name: "Pizza", sortOrder: 1 },
    { id: "cat-pasta", name: "Pasta", sortOrder: 2 },
    { id: "cat-kebab", name: "Kebab", sortOrder: 3 },
    { id: "cat-salat", name: "Salate & Beilagen", sortOrder: 4 },
    { id: "cat-drinks", name: "Getränke", sortOrder: 5 },
    { id: "cat-dessert", name: "Desserts", sortOrder: 6 },
  ],
  groups: [
    {
      id: "grp-size",
      name: "Grösse",
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 1,
      options: [
        opt("opt-size-normal", "Normal", 0, ["klein", "normal", "32 cm"], { isDefault: true, sortOrder: 1 }),
        opt("opt-size-gross", "Gross", 500, ["gross", "grosse", "grossi", "40 cm", "family"], { sortOrder: 2 }),
      ],
    },
    {
      id: "grp-extras",
      name: "Pizza-Extras",
      minSelect: 0,
      maxSelect: 5,
      sortOrder: 2,
      options: [
        opt("opt-x-mozz", "Extra Mozzarella", 200, ["extra Käse", "mehr Käse", "extra Chäs", "Käse"], { sortOrder: 1 }),
        opt("opt-x-scharf", "Scharf", 0, ["pikant", "Peperoncini", "scharf"], { sortOrder: 2 }),
        opt("opt-x-oliven", "Oliven", 150, ["Olive"], { sortOrder: 3 }),
        opt("opt-x-rucola", "Rucola", 200, ["Rocket", "Ruccola"], { sortOrder: 4 }),
        opt("opt-x-schinken", "Schinken", 300, ["Hinterschinken"], { sortOrder: 5 }),
        opt("opt-x-pilze", "Champignons", 200, ["Pilze", "Champignon"], { sortOrder: 6 }),
      ],
    },
    {
      id: "grp-sauce",
      name: "Sauce",
      minSelect: 1,
      maxSelect: 2,
      sortOrder: 3,
      options: [
        opt("opt-sauce-knobli", "Knoblauchsauce", 0, ["Knoblauch", "Knobli", "Knoblisauce"], { isDefault: true, sortOrder: 1 }),
        opt("opt-sauce-cocktail", "Cocktailsauce", 0, ["Cocktail"], { sortOrder: 2 }),
        opt("opt-sauce-scharf", "Scharfe Sauce", 0, ["scharf", "Chili", "Chilisauce"], { sortOrder: 3 }),
        opt("opt-sauce-joghurt", "Joghurtsauce", 0, ["Joghurt", "Jogurt"], { sortOrder: 4 }),
      ],
    },
    {
      id: "grp-menu-drink",
      name: "Menü-Getränk",
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 4,
      options: [
        opt("opt-d-cola", "Coca-Cola 0.5l", 0, ["Cola", "Coke", "Coca Cola"], { sortOrder: 1 }),
        opt("opt-d-zero", "Coca-Cola Zero 0.5l", 0, ["Cola Zero", "Coke Zero", "Zero"], { sortOrder: 2 }),
        opt("opt-d-fanta", "Fanta 0.5l", 0, ["Fanta"], { sortOrder: 3 }),
        opt("opt-d-rivella", "Rivella Rot 0.5l", 0, ["Rivella"], { sortOrder: 4 }),
        opt("opt-d-mineral", "Mineralwasser 0.5l", 0, ["Wasser", "Mineral", "Henniez"], { sortOrder: 5 }),
      ],
    },
  ],
  items: [] as ItemDef[],
};

const item = (
  id: string,
  categoryId: string,
  name: string,
  priceCents: number,
  extra: Partial<ItemDef> = {},
): ItemDef => ({
  id,
  categoryId,
  name,
  priceCents,
  description: null,
  code: null,
  aliases: [],
  tags: [],
  isAvailable: true,
  sortOrder: 0,
  groupIds: [],
  ...extra,
});

const PIZZA_GROUPS = ["grp-size", "grp-extras"];

demoMenu.items = [
  item("item-margherita", "cat-pizza", "Margherita", 1600, {
    code: "1",
    aliases: ["Pizza Margherita", "Margarita"],
    description: "Tomaten, Mozzarella, Oregano",
    tags: ["vegetarisch"],
    groupIds: PIZZA_GROUPS,
    sortOrder: 1,
  }),
  item("item-prosciutto", "cat-pizza", "Prosciutto", 1950, {
    code: "2",
    aliases: ["Pizza Prosciutto", "Schinkenpizza", "Pizza mit Schinken"],
    description: "Tomaten, Mozzarella, Schinken",
    groupIds: PIZZA_GROUPS,
    sortOrder: 2,
  }),
  item("item-napoli", "cat-pizza", "Pizza Napoli", 1850, {
    code: "3",
    aliases: ["Napoli", "Combo 3", "Menü 3", "Napoletana"],
    description: "Tomaten, Mozzarella, Sardellen, Kapern, Oliven",
    groupIds: PIZZA_GROUPS,
    sortOrder: 3,
  }),
  item("item-funghi", "cat-pizza", "Funghi", 1800, {
    code: "4",
    aliases: ["Pizza Funghi", "Pilzpizza"],
    description: "Tomaten, Mozzarella, Champignons",
    tags: ["vegetarisch"],
    groupIds: PIZZA_GROUPS,
    sortOrder: 4,
  }),
  item("item-diavola", "cat-pizza", "Diavola", 2000, {
    code: "5",
    aliases: ["Pizza Diavola", "scharfe Salami Pizza"],
    description: "Tomaten, Mozzarella, scharfe Salami, Peperoncini",
    tags: ["scharf"],
    groupIds: PIZZA_GROUPS,
    sortOrder: 5,
  }),
  item("item-4formaggi", "cat-pizza", "Quattro Formaggi", 2100, {
    code: "6",
    aliases: ["Vier Käse", "4 Formaggi", "Quattro Formaggi Pizza", "Vierkäsepizza"],
    description: "Mozzarella, Gorgonzola, Parmesan, Fontina",
    tags: ["vegetarisch"],
    groupIds: PIZZA_GROUPS,
    sortOrder: 6,
  }),
  item("item-hawaii", "cat-pizza", "Hawaii", 1950, {
    code: "7",
    aliases: ["Pizza Hawaii"],
    description: "Tomaten, Mozzarella, Schinken, Ananas",
    groupIds: PIZZA_GROUPS,
    sortOrder: 7,
  }),
  item("item-bolo", "cat-pasta", "Spaghetti Bolognese", 1750, {
    aliases: ["Spaghetti Bolo", "Bolognese", "Spaghetti mit Hackfleischsauce"],
    sortOrder: 1,
  }),
  item("item-arrabbiata", "cat-pasta", "Penne Arrabbiata", 1650, {
    aliases: ["Arrabbiata", "Penne scharf"],
    tags: ["vegetarisch", "scharf"],
    sortOrder: 2,
  }),
  item("item-lasagne", "cat-pasta", "Lasagne", 1900, { aliases: ["Lasagna"], sortOrder: 3 }),
  item("item-doener", "cat-kebab", "Döner Kebab im Fladenbrot", 1300, {
    aliases: ["Döner", "Kebab", "Kebab im Brot", "Dönerkebab", "Döner im Brot"],
    groupIds: ["grp-sauce"],
    sortOrder: 1,
  }),
  item("item-duerum", "cat-kebab", "Dürüm Kebab", 1400, {
    aliases: ["Dürüm", "Durum", "Yufka", "Kebab im Wrap"],
    groupIds: ["grp-sauce"],
    sortOrder: 2,
  }),
  item("item-kebabmenu", "cat-kebab", "Kebab-Menü", 1750, {
    code: "M1",
    aliases: ["Kebab Menü", "Dönermenü", "Menü 1"],
    description: "Döner Kebab im Fladenbrot mit Pommes frites und Getränk",
    groupIds: ["grp-sauce", "grp-menu-drink"],
    sortOrder: 3,
  }),
  item("item-gruener", "cat-salat", "Grüner Salat", 750, {
    aliases: ["kleiner Salat", "Salat"],
    tags: ["vegan"],
    sortOrder: 1,
  }),
  item("item-mista", "cat-salat", "Insalata Mista", 950, {
    aliases: ["gemischter Salat", "Mista"],
    tags: ["vegetarisch"],
    sortOrder: 2,
  }),
  item("item-pommes", "cat-salat", "Pommes frites", 600, {
    aliases: ["Pommes", "Fritten", "Fries"],
    tags: ["vegan"],
    sortOrder: 3,
  }),
  item("item-cola", "cat-drinks", "Coca-Cola 0.5l", 450, {
    aliases: ["Cola", "Coke", "Coca Cola"],
    sortOrder: 1,
  }),
  item("item-zero", "cat-drinks", "Coca-Cola Zero 0.5l", 450, {
    aliases: ["Cola Zero", "Coke Zero"],
    sortOrder: 2,
  }),
  item("item-rivella", "cat-drinks", "Rivella Rot 0.5l", 450, { aliases: ["Rivella"], sortOrder: 3 }),
  item("item-mineral", "cat-drinks", "Mineralwasser 0.5l", 400, {
    aliases: ["Mineral", "Wasser", "Henniez"],
    sortOrder: 4,
  }),
  item("item-bier", "cat-drinks", "Bier 0.5l", 600, {
    aliases: ["Bier", "Feldschlösschen", "Stange"],
    sortOrder: 5,
  }),
  item("item-tiramisu", "cat-dessert", "Tiramisu", 850, { sortOrder: 1 }),
  item("item-pannacotta", "cat-dessert", "Panna Cotta", 750, { aliases: ["Pannacotta"], sortOrder: 2 }),
];
