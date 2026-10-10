"use server";

import { and, eq, invitations, memberships, restaurants, user } from "@justcall/db";
import { sendMail } from "@justcall/services";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { audit } from "../audit";
import { db } from "../db";
import { requireAdmin, requireRestaurantAccess } from "../session";
import { hashToken, newToken } from "../users";
import { fail, firstError, type ActionResult } from "./helpers";

const inviteSchema = z.object({
  email: z.email().transform((e) => e.trim().toLowerCase()),
  role: z.enum(["owner", "staff", "admin"]),
});

/**
 * Invites someone by email. Restaurant invites (owner/staff) can be sent by admins and restaurant
 * owners; platform admin invites only by admins. The link is also returned so it can be shared
 * manually when email is not configured.
 */
export async function inviteUser(
  restaurantId: string | null,
  input: { email: string; role: string },
): Promise<ActionResult> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  const { email, role } = parsed.data;

  let inviterId: string;
  let restaurantName: string | null = null;
  if (role === "admin") {
    if (restaurantId) return fail("Admins are invited from the platform settings.");
    inviterId = (await requireAdmin()).id;
  } else {
    if (!restaurantId) return fail("Restaurant missing");
    const access = await requireRestaurantAccess(restaurantId, "owner");
    inviterId = access.user.id;
    restaurantName = access.restaurant.name;
  }

  const token = newToken();
  await db.insert(invitations).values({
    email,
    tokenHash: hashToken(token),
    platformRole: role === "admin" ? "admin" : "member",
    restaurantId: role === "admin" ? null : restaurantId,
    membershipRole: role === "admin" ? null : (role as "owner" | "staff"),
    invitedByUserId: inviterId,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
  });
  const link = `${env.appUrl}/invite/${token}`;
  const mail = await sendMail({
    to: email,
    subject: restaurantName ? `Einladung zu JustCall – ${restaurantName}` : "Einladung zu JustCall",
    text: [
      "Grüezi",
      "",
      restaurantName
        ? `Sie wurden eingeladen, die telefonischen Bestellungen von ${restaurantName} in JustCall zu verwalten.`
        : "Sie wurden als Administrator zu JustCall eingeladen.",
      "",
      `Einladung annehmen (7 Tage gültig): ${link}`,
      "",
      "Freundliche Grüsse",
      "JustCall",
    ].join("\n"),
  }).catch((err) => ({ delivered: false, error: String(err) }));
  await audit(inviterId, "invite.create", { restaurantId, data: { email, role } });
  revalidatePath(restaurantId ? `/admin/restaurants/${restaurantId}/team` : "/admin/settings");
  return {
    ok: true,
    message: mail.delivered
      ? `Invitation sent to ${email}`
      : `Invitation created – email not delivered, share the link manually`,
    data: { link },
  };
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  const [inv] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.id, invitationId))
    .limit(1);
  if (!inv) return fail("Invitation not found");
  if (inv.restaurantId) await requireRestaurantAccess(inv.restaurantId, "owner");
  else await requireAdmin();
  await db.delete(invitations).where(eq(invitations.id, invitationId));
  revalidatePath(
    inv.restaurantId ? `/admin/restaurants/${inv.restaurantId}/team` : "/admin/settings",
  );
  return { ok: true, message: "Invitation revoked" };
}

export async function removeMember(restaurantId: string, userId: string): Promise<ActionResult> {
  const access = await requireRestaurantAccess(restaurantId, "owner");
  await db
    .delete(memberships)
    .where(and(eq(memberships.restaurantId, restaurantId), eq(memberships.userId, userId)));
  await audit(access.user.id, "member.remove", { restaurantId, data: { userId } });
  revalidatePath(`/admin/restaurants/${restaurantId}/team`);
  return { ok: true, message: "Member removed" };
}

export async function setMemberRole(
  restaurantId: string,
  userId: string,
  role: "owner" | "staff",
): Promise<ActionResult> {
  const access = await requireRestaurantAccess(restaurantId, "owner");
  await db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.restaurantId, restaurantId), eq(memberships.userId, userId)));
  await audit(access.user.id, "member.role", { restaurantId, data: { userId, role } });
  revalidatePath(`/admin/restaurants/${restaurantId}/team`);
  return { ok: true, message: "Role updated" };
}

export async function setPlatformRole(
  userId: string,
  role: "admin" | "member",
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (userId === admin.id && role !== "admin")
    return fail("You cannot remove your own admin role.");
  await db.update(user).set({ role }).where(eq(user.id, userId));
  await audit(admin.id, "user.role", { data: { userId, role } });
  revalidatePath("/admin/settings");
  return { ok: true, message: "Role updated" };
}

export async function listRestaurantsForSelect() {
  await requireAdmin();
  return db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .orderBy(restaurants.name);
}
