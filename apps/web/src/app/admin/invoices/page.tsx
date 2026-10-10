import { formatChf } from "@justcall/core";
import { desc, eq, invoices, restaurants, sql } from "@justcall/db";
import { GenerateInvoiceButton } from "@/components/invoice-actions";
import { InvoicesTable } from "@/components/tables";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { Notice, PageHeader } from "@/components/ui/misc";
import { db } from "@/server/db";
import { getPlatformSettings } from "@justcall/db";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  const [rows, [sums], settings] = await Promise.all([
    db
      .select({
        id: invoices.id,
        number: invoices.number,
        periodStart: invoices.periodStart,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        status: invoices.status,
        orderCount: invoices.orderCount,
        orderVolumeCents: invoices.orderVolumeCents,
        totalCents: invoices.totalCents,
        restaurantName: restaurants.name,
      })
      .from(invoices)
      .innerJoin(restaurants, eq(restaurants.id, invoices.restaurantId))
      .orderBy(desc(invoices.issueDate), desc(invoices.number))
      .limit(300),
    db
      .select({
        open: sql<number>`coalesce(sum(total_cents) filter (where status = 'sent'), 0)::int`,
        overdue: sql<number>`coalesce(sum(total_cents) filter (where status = 'sent' and due_date < current_date), 0)::int`,
        drafts: sql<number>`count(*) filter (where status = 'draft')::int`,
        paidYear: sql<number>`coalesce(sum(total_cents) filter (where status = 'paid' and date_part('year', issue_date) = date_part('year', current_date)), 0)::int`,
      })
      .from(invoices),
    getPlatformSettings(db),
  ]);
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Monthly invoices are generated automatically on the 1st (06:00) as drafts. Review, then send them by email with a Swiss QR-bill."
        actions={<GenerateInvoiceButton />}
      />
      {!settings.iban || !settings.street ? (
        <Notice tone="warning" className="mb-4" title="Company details incomplete">
          Add your company address and IBAN under Settings so invoices include a QR-bill payment
          slip.
        </Notice>
      ) : null}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Drafts to review" value={sums?.drafts ?? 0} />
        <Stat label="Open (sent)" value={formatChf(sums?.open ?? 0)} />
        <Stat label="Overdue" value={formatChf(sums?.overdue ?? 0)} />
        <Stat label="Paid this year" value={formatChf(sums?.paidYear ?? 0)} />
      </div>
      <Card>
        <CardHeader title="All invoices" />
        <InvoicesTable rows={rows} />
      </Card>
    </>
  );
}
