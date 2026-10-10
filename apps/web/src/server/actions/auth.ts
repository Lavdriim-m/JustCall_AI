"use server";

import { and, eq, gt, invitations, isNull, memberships } from "@justcall/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "../auth";
import { db } from "../db";
import { createUserWithPassword, findUserByEmail, hashToken, userCount } from "../users";

export type FormState = { error?: string; ok?: boolean; message?: string } | undefined;

const passwordSchema = z
  .string()
  .min(10, "Das Passwort muss mindestens 10 Zeichen haben.")
  .max(128);

const setupSchema = z.object({
  name: z.string().trim().min(2, "Bitte Namen angeben."),
  email: z.email("Ungültige E-Mail-Adresse."),
  password: passwordSchema,
});

/** First-run: creates the platform administrator. Only works while no user exists. */
export async function setupFirstAdmin(_prev: FormState, formData: FormData): Promise<FormState> {
  if ((await userCount()) > 0)
    return { error: "Die Einrichtung ist bereits abgeschlossen. Bitte melden Sie sich an." };
  const parsed = setupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  await createUserWithPassword({ ...parsed.data, role: "admin" });
  await getAuth().api.signInEmail({
    body: { email: parsed.data.email, password: parsed.data.password },
    headers: await headers(),
  });
  redirect("/admin");
}

const inviteSchema = z.object({
  name: z.string().trim().min(2, "Bitte Namen angeben."),
  password: passwordSchema,
});

export async function acceptInvitation(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const [invite] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.tokenHash, hashToken(token)),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!invite) return { error: "Diese Einladung ist ungültig oder abgelaufen." };

  const existing = await findUserByEmail(invite.email);
  if (existing) {
    if (invite.restaurantId) {
      await db
        .insert(memberships)
        .values({
          userId: existing.id,
          restaurantId: invite.restaurantId,
          role: invite.membershipRole ?? "staff",
        })
        .onConflictDoNothing();
    }
    await db
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, invite.id));
    redirect("/login?invited=1");
  }

  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const created = await createUserWithPassword({
    name: parsed.data.name,
    email: invite.email,
    password: parsed.data.password,
    role: invite.platformRole,
  });
  if (invite.restaurantId) {
    await db
      .insert(memberships)
      .values({
        userId: created.id,
        restaurantId: invite.restaurantId,
        role: invite.membershipRole ?? "staff",
      });
  }
  await db.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invite.id));
  await getAuth().api.signInEmail({
    body: { email: invite.email, password: parsed.data.password },
    headers: await headers(),
  });
  redirect("/");
}

export async function signOutAction() {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/login");
}
