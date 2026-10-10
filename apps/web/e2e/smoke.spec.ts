import { expect, test, type Page } from "@playwright/test";

const ADMIN = {
  name: "E2E Admin",
  email: process.env.E2E_EMAIL ?? "admin@justcall.test",
  password: process.env.E2E_PASSWORD ?? "e2e-password-123",
};
const shots = process.env.E2E_SCREENSHOTS;

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

async function signIn(page: Page) {
  await page.goto("/");
  if (page.url().includes("/setup")) {
    await page.getByLabel("Your name").fill(ADMIN.name);
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await shot(page, "01-setup");
    await page.getByRole("button", { name: "Create admin account" }).click();
  } else if (page.url().includes("/login")) {
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await page.waitForURL(/\/admin/);
}

test("admin can onboard, test-call and see the order on the restaurant board", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await shot(page, "02-overview");

  await page.getByRole("link", { name: "Restaurants", exact: true }).click();
  await page.getByRole("link", { name: "Pizzeria Bella Vista" }).first().click();
  await expect(page.getByText("Go-live checklist")).toBeVisible();
  await shot(page, "03-restaurant-overview");

  // Menu + alias matching
  await page.getByRole("main").getByRole("link", { name: "Menu", exact: true }).click();
  await page.getByPlaceholder(/combo drü/).fill("combo drei");
  await expect(page.getByText("Pizza Napoli", { exact: false }).first()).toBeVisible();
  await shot(page, "04-menu");

  await page.getByRole("main").getByRole("link", { name: "Settings", exact: true }).click();
  await page.waitForURL(/\/settings$/);
  await expect(page.getByText("Voice assistant")).toBeVisible();
  await shot(page, "05-settings");

  await page.getByRole("main").getByRole("link", { name: "Opening hours" }).click();
  await page.waitForURL(/\/hours$/);
  await expect(page.getByText("Weekly opening hours")).toBeVisible();
  await shot(page, "06-hours");

  await page.getByRole("main").getByRole("link", { name: "Phone", exact: true }).click();
  await page.waitForURL(/\/phone$/);
  await expect(page.getByText("Forward the restaurant's number")).toBeVisible();
  await shot(page, "07-phone");

  // Simulated call (text mode)
  await page.getByRole("main").getByRole("link", { name: "Test call" }).click();
  await page.getByRole("button", { name: "Start text conversation" }).click();
  await expect(page.getByText("Grüezi und herzlich willkommen")).toBeVisible();
  const say = async (text: string) => {
    await page.getByPlaceholder("Type what the caller says…").fill(text);
    await page.keyboard.press("Enter");
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(600);
  };
  await say("Grüezi, ich hätt gern zwei Napoli und ein Cola");
  await expect(page.getByText(/Allergie/i).last()).toBeVisible();
  await say("Nein");
  await say("Das wars, ich hole es so schnell wie möglich ab");
  await say("Müller");
  await say("TWINT");
  await expect(page.getByText(/Ich fasse zusammen/)).toBeVisible();
  await say("Ja genau");
  await expect(page.getByText(/Ihre Bestellnummer ist/)).toBeVisible();
  await expect(page.getByText(/SMS to customer/)).toBeVisible();
  await shot(page, "08-test-call");

  // Restaurant portal orders board
  await page.goto("/r/pizzeria-bella-vista/orders");
  await expect(page.getByText("Telefon-Assistent aktiv")).toBeVisible();
  await expect(page.getByText("Müller").first()).toBeVisible();
  await shot(page, "09-orders-board");
  await page.getByRole("button", { name: "Annehmen" }).first().click();
  await expect(page.getByRole("button", { name: "Bereit" }).first()).toBeVisible();

  await page.goto("/r/pizzeria-bella-vista/menu");
  await shot(page, "10-portal-menu");

  // Calls list and transcript
  await page.goto("/admin/calls?tests=1");
  await page
    .getByRole("main")
    .getByRole("link")
    .filter({ hasText: /\d{2}\.\d{2}\.\d{2}/ })
    .first()
    .click();
  await page.waitForURL(/\/admin\/calls\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
  await shot(page, "11-call-detail");

  await page.goto("/admin/invoices");
  await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
  await shot(page, "12-invoices");

  await page.goto("/admin/system");
  await shot(page, "13-system");
});
