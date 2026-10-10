import { and, desc, eq, invoices, ne } from "@justcall/db";
import { notFound } from "next/navigation";
import { InvoicesTable } from "@/components/tables";
import { Card } from "@/components/ui/card";
import { db } from "@/server/db";
import { requireRestaurantAccess } from "@/server/session";

export const metadata = { title: "Rechnungen" };

export default async function PortalInvoicesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const access = await requireRestaurantAccess(slug);
  if (access.role === "staff") notFound();
  const rows = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.restaurantId, access.restaurant.id),
        ne(invoices.status, "draft"),
        ne(invoices.status, "void"),
      ),
    )
    .orderBy(desc(invoices.periodStart));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Rechnungen</h1>
      <p className="text-sm text-muted">
        Monatliche Abrechnung der telefonischen Bestellungen über JustCall. Klicken Sie auf die
        Nummer für das PDF mit QR-Einzahlungsschein.
      </p>
      <Card>
        <InvoicesTable rows={rows} showRestaurant={false} linkBase={null} />
      </Card>
    </div>
  );
}
