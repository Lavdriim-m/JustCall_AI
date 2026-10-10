import { formatSwissNumber } from "@justcall/core";
import { eq, phoneNumbers, restaurants } from "@justcall/db";
import { isTwilioConfigured, listIncomingNumbers } from "@justcall/services";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice, PageHeader } from "@/components/ui/misc";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { env } from "@/lib/env";
import { db } from "@/server/db";
import { BuyNumber } from "./buy-number";

export const metadata = { title: "Phone numbers" };

export default async function NumbersPage() {
  const configured = isTwilioConfigured();
  let twilioError: string | null = null;
  const twilioNumbers = configured
    ? await listIncomingNumbers().catch((err: unknown) => {
        twilioError = err instanceof Error ? err.message : String(err);
        return [];
      })
    : [];
  const rows = await db
    .select({
      number: phoneNumbers,
      restaurantName: restaurants.name,
      restaurantId: restaurants.id,
    })
    .from(phoneNumbers)
    .leftJoin(restaurants, eq(restaurants.id, phoneNumbers.restaurantId));
  const byE164 = new Map(rows.map((r) => [r.number.e164, r]));
  const expectedUrl = `${env.voiceUrl}/twilio/voice`;
  const all = [
    ...twilioNumbers.map((t) => ({
      e164: t.phoneNumber,
      sid: t.sid,
      voiceUrl: t.voiceUrl as string | null,
      inTwilio: true,
    })),
    ...rows
      .filter((r) => !twilioNumbers.some((t) => t.phoneNumber === r.number.e164))
      .map((r) => ({
        e164: r.number.e164,
        sid: r.number.providerSid,
        voiceUrl: null,
        inTwilio: false,
      })),
  ];
  const restaurantList = await db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .orderBy(restaurants.name);

  return (
    <>
      <PageHeader
        title="Phone numbers"
        description="Every JustCall number and the restaurant it answers for. Restaurants forward their own number to one of these."
      />
      {!configured ? (
        <Notice tone="warning" className="mb-4" title="Twilio not configured">
          Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to list, buy and configure numbers here. See
          docs/SETUP.md.
        </Notice>
      ) : null}
      {twilioError ? (
        <Notice tone="error" className="mb-4" title="Twilio error">
          {twilioError}
        </Notice>
      ) : null}
      <Card className="mb-6">
        <Table>
          <THead>
            <tr>
              <TH>Number</TH>
              <TH>Restaurant</TH>
              <TH>Forwarded from</TH>
              <TH>Voice webhook</TH>
            </tr>
          </THead>
          <TBody>
            {all.length === 0 ? (
              <EmptyRow colSpan={4}>
                No numbers yet. Buy a Swiss number below or in the Twilio console.
              </EmptyRow>
            ) : (
              all.map((n) => {
                const link = byE164.get(n.e164);
                return (
                  <TR key={n.e164}>
                    <TD className="font-medium">{formatSwissNumber(n.e164)}</TD>
                    <TD>
                      {link?.restaurantId ? (
                        <Link
                          href={`/admin/restaurants/${link.restaurantId}/phone`}
                          className="hover:underline"
                        >
                          {link.restaurantName}
                        </Link>
                      ) : (
                        <span className="text-muted">Unassigned</span>
                      )}
                    </TD>
                    <TD className="text-muted">
                      {link?.number.forwardedFrom
                        ? formatSwissNumber(link.number.forwardedFrom)
                        : "–"}
                    </TD>
                    <TD>
                      {!n.inTwilio ? (
                        <Badge>Not in Twilio account</Badge>
                      ) : n.voiceUrl === expectedUrl ? (
                        <Badge tone="green">JustCall</Badge>
                      ) : (
                        <Badge tone="yellow" title={n.voiceUrl ?? ""}>
                          {n.voiceUrl ? "Points elsewhere" : "Not set"}
                        </Badge>
                      )}
                    </TD>
                  </TR>
                );
              })
            )}
          </TBody>
        </Table>
      </Card>
      {configured ? (
        <Card>
          <CardHeader
            title="Buy a Swiss number"
            description="Swiss numbers need an approved regulatory bundle in Twilio (business address in Switzerland). Set TWILIO_CH_BUNDLE_SID and TWILIO_CH_ADDRESS_SID."
          />
          <CardBody>
            <BuyNumber restaurants={restaurantList} />
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
