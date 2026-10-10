/**
 * Creates (or promotes) a platform administrator from the command line.
 *   pnpm admin:create --email you@example.ch --name "Your Name" --password "..."
 * Without --password a random one is generated and printed.
 */
import { randomBytes } from "node:crypto";
import { account, closeDb, eq, getDb, user } from "@justcall/db";
import { hashPassword } from "better-auth/crypto";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  if (!email)
    throw new Error(
      "Usage: pnpm admin:create --email you@example.ch [--name 'Name'] [--password '...']",
    );
  const name = arg("name") ?? email.split("@")[0]!;
  const password = arg("password") ?? randomBytes(12).toString("base64url");
  if (password.length < 10) throw new Error("Password must have at least 10 characters");
  const db = getDb();
  const [existing] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  const hash = await hashPassword(password);
  if (existing) {
    await db.update(user).set({ role: "admin" }).where(eq(user.id, existing.id));
    const [acc] = await db.select().from(account).where(eq(account.userId, existing.id)).limit(1);
    if (arg("password")) {
      if (acc) await db.update(account).set({ password: hash }).where(eq(account.id, acc.id));
      else
        await db
          .insert(account)
          .values({
            id: crypto.randomUUID(),
            accountId: existing.id,
            providerId: "credential",
            userId: existing.id,
            password: hash,
          });
    }
    console.log(
      `✓ ${email} is now an administrator${arg("password") ? " (password updated)" : ""}.`,
    );
  } else {
    const id = crypto.randomUUID();
    await db.insert(user).values({ id, name, email, emailVerified: true, role: "admin" });
    await db
      .insert(account)
      .values({
        id: crypto.randomUUID(),
        accountId: id,
        providerId: "credential",
        userId: id,
        password: hash,
      });
    console.log(`✓ Administrator created: ${email}`);
    if (!arg("password")) console.log(`  Temporary password: ${password}`);
  }
  await closeDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await closeDb();
  process.exit(1);
});
