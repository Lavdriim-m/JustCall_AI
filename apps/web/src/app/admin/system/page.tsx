import { sql } from "@justcall/db";
import { isMailConfigured, isTwilioConfigured, verifyTwilioCredentials } from "@justcall/services";
import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Kbd, PageHeader } from "@/components/ui/misc";
import { env } from "@/lib/env";
import { db } from "@/server/db";
import { voiceHealth } from "@/server/voice";

export const metadata = { title: "System status" };

type Check = { name: string; state: "ok" | "warn" | "off"; detail: string };

export default async function SystemPage() {
  const checks: Check[] = [];
  try {
    const [row] = (await db.execute(
      sql`select now() as now, (select count(*)::int from restaurants) as restaurants`,
    )) as unknown as { restaurants: number }[];
    checks.push({
      name: "Database",
      state: "ok",
      detail: `Connected · ${row?.restaurants ?? 0} restaurants`,
    });
  } catch (err) {
    checks.push({ name: "Database", state: "warn", detail: String(err) });
  }
  const voice = await voiceHealth();
  checks.push({
    name: "Voice server",
    state: voice.ok ? "ok" : "warn",
    detail: voice.ok
      ? `Reachable at ${env.voiceUrl} · ${voice.activeCalls} active calls · STT ${voice.stt} · TTS ${voice.tts} · LLM ${voice.llm}`
      : `Not reachable at ${env.voiceInternalUrl} (${voice.error})`,
  });
  if (isTwilioConfigured()) {
    try {
      const acc = await verifyTwilioCredentials();
      checks.push({
        name: "Twilio",
        state: acc.status === "active" ? "ok" : "warn",
        detail: `${acc.friendlyName} · ${acc.status} · ${acc.type}`,
      });
    } catch (err) {
      checks.push({
        name: "Twilio",
        state: "warn",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  } else
    checks.push({
      name: "Twilio",
      state: "off",
      detail: "Not configured – no real phone calls or SMS.",
    });
  checks.push({
    name: "Email (SMTP)",
    state: isMailConfigured() ? "ok" : "off",
    detail: isMailConfigured()
      ? `${process.env.SMTP_HOST} as ${process.env.EMAIL_FROM}`
      : "Not configured – emails are written to the server log.",
  });
  const llmProvider = process.env.LLM_PROVIDER ?? "openai";
  const llmKey =
    llmProvider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  checks.push({
    name: "Language model (web)",
    state: llmProvider === "demo" ? "off" : llmKey && llmKey.length > 20 ? "ok" : "warn",
    detail:
      llmProvider === "demo"
        ? "Demo mode (rule-based) – set LLM_PROVIDER=openai and OPENAI_API_KEY for real conversations."
        : `${llmProvider} · ${llmProvider === "anthropic" ? (process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5") : (process.env.OPENAI_MODEL ?? "gpt-5.4-mini")} · key ${llmKey ? "set" : "missing"} (used for AI menu import; calls use the voice server's settings)`,
  });
  checks.push({
    name: "Secrets",
    state:
      process.env.BETTER_AUTH_SECRET && process.env.INTERNAL_API_SECRET && process.env.CRON_SECRET
        ? "ok"
        : "warn",
    detail: ["BETTER_AUTH_SECRET", "INTERNAL_API_SECRET", "CRON_SECRET"]
      .map((k) => `${k} ${process.env[k] ? "✓" : "missing"}`)
      .join(" · "),
  });
  checks.push({
    name: "Public URLs",
    state: env.appUrl.startsWith("https://") && env.voiceUrl.startsWith("https://") ? "ok" : "warn",
    detail: `APP_URL ${env.appUrl} · VOICE_PUBLIC_URL ${env.voiceUrl}${env.appUrl.startsWith("https://") ? "" : " (use https in production)"}`,
  });

  return (
    <>
      <PageHeader
        title="System status"
        description="Live checks of every integration. Run `pnpm doctor` on the voice server for deeper tests (real STT/TTS/LLM requests)."
      />
      <Card>
        <ul className="divide-y divide-[var(--border)]">
          {checks.map((c) => (
            <li key={c.name} className="flex items-start gap-3 px-5 py-4">
              {c.state === "ok" ? (
                <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" />
              ) : c.state === "warn" ? (
                <CircleAlert className="mt-0.5 size-5 text-amber-600" />
              ) : (
                <CircleDashed className="mt-0.5 size-5 text-muted" />
              )}
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="text-sm text-muted">{c.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Scheduled jobs" />
        <CardBody className="space-y-2 text-sm">
          <p>
            <strong>Monthly invoices</strong> – 1st of each month, 06:00 Europe/Zurich, created as
            drafts by the voice server (<Kbd>JOBS_ENABLED=true</Kbd>). Automatic sending:{" "}
            <Kbd>INVOICE_AUTO_SEND=true</Kbd>. Alternative trigger:{" "}
            <Kbd>GET /api/cron/monthly-invoices</Kbd> with{" "}
            <Kbd>Authorization: Bearer CRON_SECRET</Kbd>.
          </p>
          <p>
            <strong>Daily maintenance</strong> – 03:15: closes stale calls and deletes transcripts
            older than <Kbd>TRANSCRIPT_RETENTION_DAYS</Kbd>.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
