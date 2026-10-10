/**
 * Applies all pending SQL migrations from ./drizzle to DATABASE_URL.
 * Usage: pnpm db:migrate
 */
import "./env";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const { db, client } = createDb({ max: 1 });
  const migrationsFolder = path.resolve(here, "../drizzle");
  console.log(`Applying migrations from ${migrationsFolder} …`);
  await migrate(db, { migrationsFolder });
  // Make sure the singleton settings row exists.
  await client`insert into platform_settings (id) values (1) on conflict (id) do nothing`;
  console.log("Migrations applied.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
