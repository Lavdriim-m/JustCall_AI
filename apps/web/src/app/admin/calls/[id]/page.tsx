import { formatChf, formatSwissNumber } from "@justcall/core";
import { asc, callEvents, calls, eq, orders, restaurants } from "@justcall/db";
import { Bot, Info, User, Wrench } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CallOutcomeBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { cn, formatDateTime, formatDuration } from "@/lib/utils";
import { db } from "@/server/db";

export const metadata = { title: "Call" };

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db
    .select({ call: calls, restaurantName: restaurants.name })
    .from(calls)
    .leftJoin(restaurants, eq(restaurants.id, calls.restaurantId))
    .where(eq(calls.id, id))
    .limit(1);
  if (!row) notFound();
  const { call } = row;
  const [events, linkedOrders] = await Promise.all([
    db
      .select()
      .from(callEvents)
      .where(eq(callEvents.callId, id))
      .orderBy(asc(callEvents.seq), asc(callEvents.id)),
    db.select().from(orders).where(eq(orders.callId, id)),
  ]);
  const usage = call.usage ?? {};
  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/admin/calls">Calls</Link>}
        title={`${row.restaurantName ?? "Call"} · ${formatDateTime(call.startedAt)}`}
        description={call.summary ?? undefined}
        actions={
          <>
            {call.isSimulation ? <Badge tone="purple">Test call</Badge> : null}
            <CallOutcomeBadge outcome={call.outcome} status={call.status} />
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Transcript"
            description="What was said, plus the assistant's actions (tools) and system events."
          />
          <CardBody className="space-y-3">
            {events.length === 0 ? (
              <p className="text-sm text-muted">No transcript recorded.</p>
            ) : null}
            {events.map((e) =>
              e.kind === "user" || e.kind === "assistant" ? (
                <div
                  key={e.id}
                  className={cn("flex gap-2", e.kind === "user" && "flex-row-reverse")}
                >
                  <div
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full",
                      e.kind === "assistant"
                        ? "bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200"
                        : "bg-zinc-200 dark:bg-zinc-700",
                    )}
                  >
                    {e.kind === "assistant" ? (
                      <Bot className="size-4" />
                    ) : (
                      <User className="size-4" />
                    )}
                  </div>
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                      e.kind === "assistant" ? "surface-muted" : "bg-brand-600 text-white",
                    )}
                  >
                    {e.content}
                    <div
                      className={cn(
                        "mt-1 text-[10px]",
                        e.kind === "user" ? "text-brand-100" : "text-muted",
                      )}
                    >
                      {new Date(e.createdAt).toLocaleTimeString("de-CH", {
                        timeZone: "Europe/Zurich",
                      })}
                    </div>
                  </div>
                </div>
              ) : e.kind === "tool" ? (
                <details
                  key={e.id}
                  className="ml-9 rounded-lg border border-dashed border-default px-3 py-1.5 text-xs text-muted"
                >
                  <summary className="cursor-pointer">
                    <Wrench className="mr-1 inline size-3" /> {e.content}
                  </summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(e.data, null, 2)}
                  </pre>
                </details>
              ) : (
                <div
                  key={e.id}
                  className="flex items-center justify-center gap-1.5 text-xs text-muted"
                >
                  <Info className="size-3" /> {e.content}
                </div>
              ),
            )}
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="space-y-2 text-sm">
              <Detail
                label="Caller"
                value={call.fromNumber ? formatSwissNumber(call.fromNumber) : "unknown"}
              />
              <Detail
                label="Dialled"
                value={call.toNumber ? formatSwissNumber(call.toNumber) : "–"}
              />
              <Detail label="Duration" value={formatDuration(call.durationSeconds)} />
              <Detail label="Status" value={call.status} />
              {call.transferReason ? (
                <Detail
                  label="Transfer"
                  value={`${call.transferReason}${call.transferTarget ? ` → ${formatSwissNumber(call.transferTarget)}` : ""}`}
                />
              ) : null}
              <Detail label="Language model" value={call.llmProvider ?? "–"} />
              <Detail label="Speech recognition" value={call.sttProvider ?? "–"} />
              <Detail label="Voice" value={call.ttsProvider ?? "–"} />
              <Detail label="Turns" value={String(usage.turns ?? "–")} />
              <Detail
                label="Tokens"
                value={
                  usage.llmInputTokens
                    ? `${usage.llmInputTokens} in · ${usage.llmCachedTokens ?? 0} cached · ${usage.llmOutputTokens} out`
                    : "–"
                }
              />
              <Detail
                label="Audio recognised"
                value={usage.sttSeconds ? `${usage.sttSeconds} s` : "–"}
              />
              <Detail
                label="Characters spoken"
                value={usage.ttsCharacters ? String(usage.ttsCharacters) : "–"}
              />
              {call.providerCallSid ? (
                <Detail label="Twilio SID" value={call.providerCallSid} />
              ) : null}
              {call.error ? (
                <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                  {call.error}
                </p>
              ) : null}
            </CardBody>
          </Card>
          {linkedOrders.map((o) => (
            <Card key={o.id}>
              <CardHeader title={`Order #${o.orderNumber}`} />
              <CardBody className="space-y-2 text-sm">
                <Detail label="Customer" value={o.customerName} />
                <Detail label="Total" value={formatChf(o.totalCents)} />
                <Link
                  href={`/admin/orders/${o.id}`}
                  className="text-brand-700 underline dark:text-brand-300"
                >
                  Open order
                </Link>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="break-all text-right">{value}</span>
    </div>
  );
}
