import { formatSwissNumber } from "@justcall/core";
import { eq, phoneNumbers } from "@justcall/db";
import { isTwilioConfigured, listIncomingNumbers } from "@justcall/services";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Kbd, Notice } from "@/components/ui/misc";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/utils";
import { db } from "@/server/db";
import { getRestaurantAccess } from "@/server/session";
import { ConnectNumberForm, NumberActions } from "./phone-forms";

export default async function PhonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getRestaurantAccess(id);
  if (!access) notFound();
  const r = access.restaurant;
  const numbers = await db.select().from(phoneNumbers).where(eq(phoneNumbers.restaurantId, r.id));
  const twilioReady = isTwilioConfigured();
  const twilioNumbers = twilioReady ? await listIncomingNumbers().catch(() => []) : [];
  const assigned = new Set(
    (
      await db
        .select({ e164: phoneNumbers.e164, restaurantId: phoneNumbers.restaurantId })
        .from(phoneNumbers)
    )
      .filter((n) => n.restaurantId)
      .map((n) => n.e164),
  );
  const free = twilioNumbers.filter((n) => !assigned.has(n.phoneNumber));
  const target = numbers[0]?.e164;

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Card>
          <CardHeader
            title="Connected numbers"
            description="Calls to these numbers are answered by the assistant of this restaurant."
          />
          {numbers.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">No number connected yet.</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {numbers.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{formatSwissNumber(n.e164)}</div>
                    <div className="text-xs text-muted">
                      {n.forwardedFrom
                        ? `Forwarded from ${formatSwissNumber(n.forwardedFrom)} · `
                        : ""}
                      {n.providerSid ? `Twilio ${n.providerSid}` : "Not in Twilio account"}
                    </div>
                  </div>
                  {n.webhookConfiguredAt ? (
                    <Badge tone="green">Webhook set {formatDateTime(n.webhookConfiguredAt)}</Badge>
                  ) : (
                    <Badge tone="yellow">Webhook not verified</Badge>
                  )}
                  <NumberActions numberId={n.id} hasSid={Boolean(n.providerSid)} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Connect a number"
            description="Pick a number from your Twilio account (webhooks are configured automatically) or enter one manually."
          />
          <CardBody>
            {!twilioReady ? (
              <Notice tone="warning" className="mb-4" title="Twilio not configured">
                Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to list and configure numbers
                automatically. You can still enter a number manually.
              </Notice>
            ) : null}
            <ConnectNumberForm
              restaurantId={r.id}
              publicPhone={r.publicPhone}
              available={free.map((n) => ({
                sid: n.sid,
                phoneNumber: n.phoneNumber,
                friendlyName: n.friendlyName,
              }))}
            />
          </CardBody>
        </Card>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Forward the restaurant's number" />
          <CardBody className="space-y-3 text-sm">
            <p>
              The restaurant keeps its existing number
              {r.publicPhone ? ` (${formatSwissNumber(r.publicPhone)})` : ""} and forwards calls to{" "}
              <strong>{target ? formatSwissNumber(target) : "the JustCall number"}</strong>. Two
              options:
            </p>
            <div>
              <div className="font-medium">A · Overflow (recommended for rush hours)</div>
              <p className="text-muted">
                Staff answer as usual; when busy or not answering, the assistant takes over.
              </p>
              <ul className="mt-1 space-y-1">
                <li>
                  Busy: <Kbd>**67*{target?.replace("+41", "0") ?? "NUMMER"}#</Kbd>
                </li>
                <li>
                  No answer (after 15 s):{" "}
                  <Kbd>**61*{target?.replace("+41", "0") ?? "NUMMER"}**15#</Kbd>
                </li>
              </ul>
            </div>
            <div>
              <div className="font-medium">B · Always</div>
              <p className="text-muted">Every call goes to the assistant.</p>
              <Kbd>**21*{target?.replace("+41", "0") ?? "NUMMER"}#</Kbd>
            </div>
            <p className="text-xs text-muted">
              Codes work on most Swiss mobile and many landline/VoIP lines (Swisscom, Sunrise,
              Salt). For business telephone systems or Swisscom blue/IP lines configure the
              forwarding in the provider&apos;s customer portal. Cancel with <Kbd>##002#</Kbd>.
            </p>
            <Notice tone="info">
              The transfer number for allergies/owner requests must be a <em>different</em> number
              (e.g. the owner&apos;s mobile), otherwise calls would loop back to the assistant.
            </Notice>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Manual Twilio setup" />
          <CardBody className="space-y-2 text-sm">
            <p className="text-muted">
              Twilio Console → Phone Numbers → your number → Voice configuration:
            </p>
            <div>
              A call comes in: <span className="font-mono text-xs">Webhook · HTTP POST</span>
              <div className="break-all rounded bg-[var(--surface-muted)] p-2 font-mono text-xs">
                {env.voiceUrl}/twilio/voice
              </div>
            </div>
            <div>
              Call status changes:
              <div className="break-all rounded bg-[var(--surface-muted)] p-2 font-mono text-xs">
                {env.voiceUrl}/twilio/status
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
