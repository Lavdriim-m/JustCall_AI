/**
 * Applies all pending SQL migrations from ./drizzle to DATABASE_URL.
 * Usage: pnpm db:migrate
 */
import "./env";
import { createDb } from "./client";
import { MIGRATIONS_FOLDER, runMigrations } from "./migrations";

async function main() {
  const { db, client } = createDb({ max: 1 });
  console.log(`Applying migrations from ${MIGRATIONS_FOLDER} …`);
  await runMigrations(db);
  // Make sure the singleton settings row exists.
  await client`insert into platform_settings (id) values (1) on conflict (id) do nothing`;
  console.log("Migrations applied.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
