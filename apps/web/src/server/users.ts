import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { account, count, eq, user } from "@justcall/db";
import { hashPassword } from "better-auth/crypto";
import { db } from "./db";

export async function userCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(user);
  return Number(row?.n ?? 0);
}

/** Creates a user with an email/password credential (used by setup, invitations and the CLI). */
export async function createUserWithPassword(input: {
  name: string;
  email: string;
  password: string;
  role: "admin" | "member";
}) {
  const email = input.email.trim().toLowerCase();
  const id = crypto.randomUUID();
  const hash = await hashPassword(input.password);
  await db.transaction(async (tx) => {
    await tx
      .insert(user)
      .values({ id, name: input.name.trim(), email, emailVerified: true, role: input.role });
    await tx.insert(account).values({
      id: crypto.randomUUID(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: hash,
    });
  });
  return { id, email };
}

export async function findUserByEmail(email: string) {
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.email, email.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken() {
  return randomBytes(24).toString("base64url");
}
