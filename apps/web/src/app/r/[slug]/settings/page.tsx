import { describeWeeklyHours, formatSwissNumber } from "@justcall/core";
import { HoursEditor } from "@/components/hours-editor";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireRestaurantAccess } from "@/server/session";
import { PortalOperational } from "@/components/portal/operational";

export const metadata = { title: "Einstellungen" };

export default async function PortalSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const access = await requireRestaurantAccess(slug);
  const r = access.restaurant;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Einstellungen</h1>
      <PortalOperational
        restaurantId={r.id}
        accepting={r.acceptingOrders}
        extraWait={r.extraWaitMinutes}
        prepTime={r.prepTimeMinutes}
      />
      <Card>
        <CardHeader title="Übersicht" />
        <CardBody className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-muted">Öffnungszeiten</div>
            <div>{describeWeeklyHours(r.openingHours)}</div>
          </div>
          <div>
            <div className="text-muted">Weiterleitung bei Allergien & Chef-Wunsch</div>
            <div>
              {r.transferPhone
                ? formatSwissNumber(r.transferPhone)
                : "nicht hinterlegt – bitte JustCall kontaktieren"}
            </div>
          </div>
          <div>
            <div className="text-muted">Zahlungsarten</div>
            <div>
              {r.paymentMethods
                .map((m) => ({ cash: "Bar", card: "Karte", twint: "TWINT" })[m])
                .join(", ")}
            </div>
          </div>
          <div>
            <div className="text-muted">Abholung / Lieferung</div>
            <div>
              {[r.pickupEnabled ? "Abholung" : null, r.deliveryEnabled ? "Lieferung" : null]
                .filter(Boolean)
                .join(" & ")}{" "}
              · Zubereitung ca. {r.prepTimeMinutes} Min.
            </div>
          </div>
        </CardBody>
      </Card>
      {access.role !== "staff" ? (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Öffnungszeiten bearbeiten</h2>
          <HoursEditor restaurantId={r.id} weekly={r.openingHours} exceptions={r.hoursExceptions} />
        </div>
      ) : null}
    </div>
  );
}
