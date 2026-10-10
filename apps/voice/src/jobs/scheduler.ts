import { getLocalParts, previousMonth } from "@justcall/core";
import {
  closeStaleCalls,
  generateMonthlyInvoices,
  jobRuns,
  sql,
  eq,
  and,
  type Database,
} from "@justcall/db";
import { sendInvoice } from "@justcall/services";
import { Cron } from "croner";
import type { Config } from "../config";
import type { Logger } from "../logger";

/**
 * Runs `fn` at most once per (job, runKey) across all server instances by inserting a row into
 * job_runs first. Returns null when another instance already handled it.
 */
export async function runOnce<T>(
  db: Database,
  job: string,
  runKey: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const [claimed] = await db
    .insert(jobRuns)
    .values({ job, runKey })
    .onConflictDoNothing()
    .returning();
  if (!claimed) return null;
  try {
    const result = await fn();
    await db
      .update(jobRuns)
      .set({
        status: "done",
        result: JSON.parse(JSON.stringify(result ?? null)),
        finishedAt: new Date(),
      })
      .where(and(eq(jobRuns.job, job), eq(jobRuns.runKey, runKey)));
    return result;
  } catch (err) {
    await db
      .update(jobRuns)
      .set({ status: "failed", result: { error: String(err) }, finishedAt: new Date() })
      .where(and(eq(jobRuns.job, job), eq(jobRuns.runKey, runKey)));
    throw err;
  }
}

export async function runMonthlyInvoices(
  db: Database,
  config: Config,
  logger: Logger,
  yearMonth?: string,
) {
  const month = yearMonth ?? previousMonth(getLocalParts(new Date(), "Europe/Zurich").date);
  return runOnce(db, "monthly-invoices", month, async () => {
    const results = await generateMonthlyInvoices(db, month);
    const created = results.filter((r) => r.result.status === "created");
    logger.info(
      { month, created: created.length, total: results.length },
      "monthly invoices generated",
    );
    let sent = 0;
    if (config.INVOICE_AUTO_SEND) {
      for (const r of created) {
        if (r.result.status !== "created") continue;
        try {
          await sendInvoice(db, r.result.invoice.id);
          sent += 1;
        } catch (err) {
          logger.error({ err, restaurant: r.name }, "sending invoice failed");
        }
      }
    }
    return {
      month,
      created: created.length,
      sent,
      results: results.map((r) => ({ restaurant: r.name, status: r.result.status })),
    };
  });
}

export async function runDailyMaintenance(db: Database, config: Config, logger: Logger) {
  const today = getLocalParts(new Date(), "Europe/Zurich").date;
  return runOnce(db, "daily-maintenance", today, async () => {
    const stale = await closeStaleCalls(db, 120);
    let deletedEvents = 0;
    if (config.TRANSCRIPT_RETENTION_DAYS > 0) {
      const res = await db.execute(
        sql`delete from call_events where created_at < now() - make_interval(days => ${config.TRANSCRIPT_RETENTION_DAYS})`,
      );
      deletedEvents = (res as unknown as { count?: number }).count ?? 0;
    }
    logger.info({ staleCalls: stale.length, deletedEvents }, "daily maintenance done");
    return { staleCalls: stale.length, deletedEvents };
  });
}

export function startScheduler(db: Database, config: Config, logger: Logger) {
  const jobs = [
    new Cron("0 6 1 * *", { timezone: "Europe/Zurich", protect: true }, async () => {
      await runMonthlyInvoices(db, config, logger).catch((err) =>
        logger.error({ err }, "monthly invoices failed"),
      );
    }),
    new Cron("15 3 * * *", { timezone: "Europe/Zurich", protect: true }, async () => {
      await runDailyMaintenance(db, config, logger).catch((err) =>
        logger.error({ err }, "daily maintenance failed"),
      );
    }),
  ];
  // Catch up if the server was down on the 1st of the month.
  setTimeout(() => {
    runMonthlyInvoices(db, config, logger).catch((err) =>
      logger.error({ err }, "monthly invoices catch-up failed"),
    );
  }, 30_000).unref();
  return () => jobs.forEach((j) => j.stop());
}
