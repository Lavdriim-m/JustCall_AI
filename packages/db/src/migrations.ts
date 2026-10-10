import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Database } from "./client";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_FOLDER = path.resolve(here, "../drizzle");

/** Applies all pending migrations (idempotent). */
export async function runMigrations(db: Database, migrationsFolder = MIGRATIONS_FOLDER) {
  await migrate(db, { migrationsFolder });
}
