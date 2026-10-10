import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

type CreateDbOptions = {
  url?: string;
  /** Max connections in the pool. Keep small on serverless platforms. */
  max?: number;
};

/**
 * Creates a Drizzle client.
 *
 * Works with any PostgreSQL server. For Supabase use the *Session pooler* connection string
 * (IPv4, port 5432) for long-running servers, or the *Transaction pooler* (port 6543) for
 * serverless deployments – prepared statements are disabled automatically for the latter.
 */
export function createDb(options: CreateDbOptions = {}) {
  const url = options.url ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. See .env.example and docs/SETUP.md.");
  }
  const isTransactionPooler = /:6543\//.test(url) || /pgbouncer=true/.test(url);
  const client = postgres(url, {
    max: options.max ?? Number(process.env.DATABASE_POOL_MAX ?? 10),
    prepare: !isTransactionPooler,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return { db, client };
}

const globalForDb = globalThis as unknown as {
  __justcallDb?: { db: Database; client: postgres.Sql };
};

/** Process-wide shared database client (safe with Next.js hot reload). */
export function getDb(): Database {
  if (!globalForDb.__justcallDb) {
    globalForDb.__justcallDb = createDb();
  }
  return globalForDb.__justcallDb.db;
}

export async function closeDb() {
  if (globalForDb.__justcallDb) {
    await globalForDb.__justcallDb.client.end({ timeout: 5 });
    globalForDb.__justcallDb = undefined;
  }
}
