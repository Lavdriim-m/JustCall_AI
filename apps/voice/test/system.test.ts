import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "@justcall/db";
import { DEV_INTERNAL_API_SECRET, internalApiSecret, loadConfig } from "../src/config";
import { createLogger } from "../src/logger";
import { buildServer } from "../src/server";
import { TEST_DB_URL } from "./helpers";

// The internal routes used here never query the database; postgres.js connects lazily.
const { db, client } = createDb({ url: TEST_DB_URL, max: 1 });
const apps: Awaited<ReturnType<typeof buildServer>>["app"][] = [];

afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await client.end();
});

async function server(env: Record<string, string>) {
  const config = loadConfig({
    STT_PROVIDER: "mock",
    TTS_PROVIDER: "mock",
    JOBS_ENABLED: "false",
    LOG_LEVEL: "warn",
    ...env,
  });
  const { app } = await buildServer({ config, db, logger: createLogger("warn") });
  apps.push(app);
  return app;
}

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

describe("internalApiSecret", () => {
  it("uses the configured secret, else the dev fallback outside production", () => {
    expect(internalApiSecret({ INTERNAL_API_SECRET: "s3cret", NODE_ENV: "production" })).toBe(
      "s3cret",
    );
    expect(internalApiSecret({ INTERNAL_API_SECRET: "", NODE_ENV: "development" })).toBe(
      DEV_INTERNAL_API_SECRET,
    );
    expect(internalApiSecret({ INTERNAL_API_SECRET: "", NODE_ENV: "production" })).toBe("");
  });
});

describe("internal routes", () => {
  it("accept the web app's dev fallback secret when INTERNAL_API_SECRET is unset", async () => {
    const app = await server({});
    const ok = await app.inject({
      method: "GET",
      url: "/internal/active-calls",
      headers: bearer(DEV_INTERNAL_API_SECRET),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ count: 0, ids: [] });

    const preview = await app.inject({
      method: "POST",
      url: "/internal/tts-preview",
      headers: bearer(DEV_INTERNAL_API_SECRET),
      payload: { text: "Grüezi" },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-type"]).toContain("audio/wav");

    const invalidate = await app.inject({
      method: "POST",
      url: "/internal/restaurants/00000000-0000-0000-0000-000000000000/invalidate",
      headers: bearer(DEV_INTERNAL_API_SECRET),
    });
    expect(invalidate.statusCode).toBe(200);

    expect((await app.inject({ method: "GET", url: "/internal/active-calls" })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/internal/active-calls",
          headers: bearer("wrong"),
        })
      ).statusCode,
    ).toBe(401);
  });

  it("reject the dev fallback in production", async () => {
    const app = await server({ NODE_ENV: "production" });
    for (const headers of [bearer(DEV_INTERNAL_API_SECRET), bearer(""), {}]) {
      const res = await app.inject({ method: "GET", url: "/internal/active-calls", headers });
      expect(res.statusCode).toBe(401);
    }
  });

  it("require the configured secret when one is set", async () => {
    const app = await server({ INTERNAL_API_SECRET: "test-secret-0123456789" });
    const ok = await app.inject({
      method: "GET",
      url: "/internal/active-calls",
      headers: bearer("test-secret-0123456789"),
    });
    expect(ok.statusCode).toBe(200);
    const dev = await app.inject({
      method: "GET",
      url: "/internal/active-calls",
      headers: bearer(DEV_INTERNAL_API_SECRET),
    });
    expect(dev.statusCode).toBe(401);
  });
});
