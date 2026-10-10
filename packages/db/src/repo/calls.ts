import { eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import { callEvents, calls, type Call } from "../schema";

export type CallEventInput = {
  kind: "user" | "assistant" | "tool" | "system" | "event";
  content?: string | null;
  data?: unknown;
  at?: Date;
};

export async function createCall(db: Database, values: typeof calls.$inferInsert): Promise<Call> {
  const [row] = await db.insert(calls).values(values).returning();
  return row!;
}

export async function updateCall(
  db: Database,
  id: string,
  values: Partial<typeof calls.$inferInsert>,
) {
  await db.update(calls).set(values).where(eq(calls.id, id));
}

/** Appends transcript events, assigning increasing sequence numbers per call. */
export async function appendCallEvents(
  db: Database,
  callId: string,
  events: CallEventInput[],
  startSeq: number,
) {
  if (!events.length) return;
  await db.insert(callEvents).values(
    events.map((e, i) => ({
      callId,
      seq: startSeq + i,
      kind: e.kind,
      content: e.content ?? null,
      data: e.data === undefined ? null : (JSON.parse(JSON.stringify(e.data)) as unknown),
      createdAt: e.at ?? new Date(),
    })),
  );
}

/** Marks calls that never received an end event (e.g. server restart) as failed. */
export async function closeStaleCalls(db: Database, olderThanMinutes = 60) {
  return db
    .update(calls)
    .set({ status: "failed", error: "Call did not finish cleanly (stale)", endedAt: sql`now()` })
    .where(
      sql`${calls.status} in ('ringing','in_progress') and ${calls.startedAt} < now() - make_interval(mins => ${olderThanMinutes})`,
    )
    .returning({ id: calls.id });
}

/** Appends a single event after the existing ones (used by webhooks after the session ended). */
export async function appendCallEvent(db: Database, callId: string, event: CallEventInput) {
  await db.execute(sql`
    insert into call_events (call_id, seq, kind, content, data)
    select ${callId}, coalesce(max(seq), -1) + 1, ${event.kind}, ${event.content ?? null}, ${event.data === undefined ? null : JSON.stringify(event.data)}::jsonb
    from call_events where call_id = ${callId}`);
}
