import { and, eq, gt, invitations, isNull, memberships, user } from "@justcall/db";
import { notFound } from "next/navigation";
import { InviteForm, MemberActions, RevokeInviteButton } from "@/components/team";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { db } from "@/server/db";
import { getRestaurantAccess } from "@/server/session";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getRestaurantAccess(id);
  if (!access) notFound();
  const r = access.restaurant;
  const [members, pending] = await Promise.all([
    db
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: memberships.role,
        since: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(eq(memberships.restaurantId, r.id)),
    db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.restaurantId, r.id),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      ),
  ]);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Restaurant access"
          description="Owners and staff use the restaurant portal: live orders board, sold-out toggles, rush-hour waiting time and invoices. Owners can also change ordering and payment settings."
        />
        <CardBody>
          <InviteForm
            restaurantId={r.id}
            roles={[
              { value: "staff", label: "Staff" },
              { value: "owner", label: "Owner" },
            ]}
          />
        </CardBody>
        <ul className="divide-y divide-[var(--border)] border-t border-default">
          {members.length === 0 && pending.length === 0 ? (
            <li className="px-5 py-4 text-sm text-muted">Nobody has access yet.</li>
          ) : null}
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{m.name}</div>
                <div className="text-xs text-muted">
                  {m.email} · since {formatDate(m.since)}
                </div>
              </div>
              <Badge tone={m.role === "owner" ? "brand" : "neutral"}>{m.role}</Badge>
              <MemberActions restaurantId={r.id} userId={m.userId} role={m.role} />
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.email}</div>
                <div className="text-xs text-muted">
                  Invitation pending · expires {formatDate(p.expiresAt)}
                </div>
              </div>
              <Badge tone="yellow">{p.membershipRole}</Badge>
              <RevokeInviteButton id={p.id} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
