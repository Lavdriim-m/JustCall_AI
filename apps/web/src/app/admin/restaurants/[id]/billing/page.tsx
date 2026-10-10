import { formatChf, formatPercentFromBps } from "@justcall/core";
import { desc, eq, invoices } from "@justcall/db";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { InvoicesTable } from "@/components/tables";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { updateRestaurant } from "@/server/actions/restaurants";
import { db } from "@/server/db";
import { getRestaurantAccess } from "@/server/session";
import { GenerateInvoiceButton } from "@/components/invoice-actions";

export default async function BillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getRestaurantAccess(id);
  if (!access) notFound();
  const r = access.restaurant;
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.restaurantId, r.id))
    .orderBy(desc(invoices.periodStart));
  const chf = (c: number) => formatChf(c, { withCurrency: false });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Pricing"
          description={`Currently ${formatPercentFromBps(r.commissionBps)} commission${r.monthlyFeeCents ? ` + ${formatChf(r.monthlyFeeCents)} per month` : ""}${r.perOrderFeeCents ? ` + ${formatChf(r.perOrderFeeCents)} per order` : ""}. Invoices are created automatically on the 1st of each month.`}
        />
        <CardBody>
          <ActionForm
            action={updateRestaurant.bind(null, r.id, "billing")}
            className="grid gap-4 sm:grid-cols-3"
          >
            <Field
              label="Commission (%)"
              htmlFor="commissionBps"
              hint="On the total of all confirmed orders."
            >
              <Input
                id="commissionBps"
                name="commissionBps"
                inputMode="decimal"
                defaultValue={(r.commissionBps / 100).toString()}
              />
            </Field>
            <Field label="Monthly fee (CHF)" htmlFor="monthlyFeeCents">
              <Input
                id="monthlyFeeCents"
                name="monthlyFeeCents"
                inputMode="decimal"
                defaultValue={chf(r.monthlyFeeCents)}
              />
            </Field>
            <Field label="Fee per order (CHF)" htmlFor="perOrderFeeCents">
              <Input
                id="perOrderFeeCents"
                name="perOrderFeeCents"
                inputMode="decimal"
                defaultValue={chf(r.perOrderFeeCents)}
              />
            </Field>
            <Field label="Billing name" htmlFor="billingName" hint="Defaults to the legal name.">
              <Input id="billingName" name="billingName" defaultValue={r.billingName ?? ""} />
            </Field>
            <Field label="Billing email" htmlFor="billingEmail">
              <Input
                id="billingEmail"
                name="billingEmail"
                type="email"
                defaultValue={r.billingEmail ?? ""}
              />
            </Field>
            <Field
              label="Billing starts on"
              htmlFor="billingStartsOn"
              hint="Orders before this date are not billed (trial)."
            >
              <Input
                id="billingStartsOn"
                name="billingStartsOn"
                type="date"
                defaultValue={r.billingStartsOn ?? ""}
              />
            </Field>
            <Field label="Street and number" htmlFor="billingStreet">
              <Input
                id="billingStreet"
                name="billingStreet"
                defaultValue={r.billingStreet ?? ""}
                placeholder={r.street ?? ""}
              />
            </Field>
            <Field label="Postal code" htmlFor="billingPostalCode">
              <Input
                id="billingPostalCode"
                name="billingPostalCode"
                defaultValue={r.billingPostalCode ?? ""}
                placeholder={r.postalCode ?? ""}
              />
            </Field>
            <Field label="City" htmlFor="billingCity">
              <Input
                id="billingCity"
                name="billingCity"
                defaultValue={r.billingCity ?? ""}
                placeholder={r.city ?? ""}
              />
            </Field>
            <input type="hidden" name="billingCountry" value={r.billingCountry || "CH"} />
            <div className="sm:col-span-3">
              <SubmitButton />
            </div>
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Invoices" actions={<GenerateInvoiceButton restaurantId={r.id} />} />
        <InvoicesTable rows={rows} showRestaurant={false} />
      </Card>
    </div>
  );
}
