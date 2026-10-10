import { formatSwissNumber } from "@justcall/core";
import { and, calls, desc, eq } from "@justcall/db";
import { CallTranscript } from "@/components/call-transcript";
import { CallOutcomeBadge } from "@/components/status";
import { Card } from "@/components/ui/card";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { db } from "@/server/db";
import { requireRestaurantAccess } from "@/server/session";

export const metadata = { title: "Anrufe" };

export default async function PortalCallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ open?: string }>;
}) {
  const { slug } = await params;
  const { open } = await searchParams;
  const access = await requireRestaurantAccess(slug);
  const rows = await db
    .select()
    .from(calls)
    .where(and(eq(calls.restaurantId, access.restaurant.id), eq(calls.isSimulation, false)))
    .orderBy(desc(calls.startedAt))
    .limit(100);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Anrufe</h1>
      <Card>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">Noch keine Anrufe.</p>
        ) : null}
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((c) => (
            <li key={c.id}>
              <details open={open === c.id}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-5 py-3 hover:bg-[var(--surface-muted)]">
                  <span className="w-36 text-sm font-medium">
                    {formatDateTime(c.startedAt, access.restaurant.timezone)}
                  </span>
                  <span className="w-36 text-sm text-muted">
                    {c.fromNumber ? formatSwissNumber(c.fromNumber) : "unbekannt"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{c.summary ?? ""}</span>
                  <span className="text-xs text-muted">{formatDuration(c.durationSeconds)}</span>
                  <CallOutcomeBadge outcome={c.outcome} status={c.status} />
                </summary>
                <div className="border-t border-default px-5 py-4">
                  <CallTranscript callId={c.id} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
