import { and, eq, gt, invitations, isNull, restaurants } from "@justcall/db";
import { db } from "@/server/db";
import { findUserByEmail, hashToken } from "@/server/users";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Invitation" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite] = await db
    .select({
      email: invitations.email,
      restaurant: restaurants.name,
      role: invitations.membershipRole,
      platformRole: invitations.platformRole,
    })
    .from(invitations)
    .leftJoin(restaurants, eq(restaurants.id, invitations.restaurantId))
    .where(
      and(
        eq(invitations.tokenHash, hashToken(token)),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!invite) {
    return (
      <>
        <h1 className="text-lg font-semibold">Invitation not valid</h1>
        <p className="mt-2 text-sm text-muted">
          This invitation link is invalid, expired or was already used. Please ask for a new one.
        </p>
      </>
    );
  }
  const existing = await findUserByEmail(invite.email);
  return (
    <>
      <h1 className="text-lg font-semibold">You are invited</h1>
      <p className="mb-5 mt-1 text-sm text-muted">
        {invite.restaurant
          ? `Join ${invite.restaurant} on JustCall as ${invite.role === "owner" ? "owner" : "staff"}.`
          : invite.platformRole === "admin"
            ? "Join JustCall as administrator."
            : "Join JustCall."}
      </p>
      <InviteForm token={token} email={invite.email} existing={Boolean(existing)} />
    </>
  );
}
