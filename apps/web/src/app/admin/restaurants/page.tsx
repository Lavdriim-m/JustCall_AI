import { formatChf, formatPercentFromBps, formatSwissNumber } from "@justcall/core";
import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { RestaurantStatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { restaurantMonthSummary } from "@/server/queries";

export const metadata = { title: "Restaurants" };

export default async function RestaurantsPage() {
  const rows = await restaurantMonthSummary();
  return (
    <>
      <PageHeader
        title="Restaurants"
        description="Every restaurant you have a deal with – menu, phone number, voice assistant and billing."
        actions={
          <Button asChild>
            <Link href="/admin/restaurants/new">
              <Plus /> New restaurant
            </Link>
          </Button>
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Building2 />} title="No restaurants yet">
            Create a restaurant, add its menu, connect a phone number and activate it.
          </EmptyState>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Status</TH>
                <TH>Phone number</TH>
                <TH className="text-right">Commission</TH>
                <TH className="text-right">Orders (month)</TH>
                <TH className="text-right">Volume (month)</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link
                      href={`/admin/restaurants/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted">/{r.slug}</div>
                  </TD>
                  <TD>
                    <RestaurantStatusBadge status={r.status} />
                  </TD>
                  <TD className="text-muted">
                    {r.numbers
                      ? r.numbers.split(", ").map(formatSwissNumber).join(", ")
                      : "Not connected"}
                  </TD>
                  <TD className="text-right">{formatPercentFromBps(r.commission_bps)}</TD>
                  <TD className="text-right tabular-nums">{r.orders}</TD>
                  <TD className="text-right tabular-nums">{formatChf(r.volume)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
