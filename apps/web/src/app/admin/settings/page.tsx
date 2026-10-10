import { formatChf } from "@justcall/core";
import { and, desc, eq, getPlatformSettings, gt, invitations, isNull, user } from "@justcall/db";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { InviteForm, PlatformRoleButton, RevokeInviteButton } from "@/components/team";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/misc";
import { formatDate } from "@/lib/utils";
import { saveSettings } from "@/server/actions/settings";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/session";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireAdmin();
  const [s, users, pending] = await Promise.all([
    getPlatformSettings(db),
    db.select().from(user).orderBy(desc(user.createdAt)),
    db
      .select()
      .from(invitations)
      .where(
        and(
          isNull(invitations.restaurantId),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      ),
  ]);
  return (
    <>
      <PageHeader
        title="Settings"
        description="Your company details (used on invoices), default pricing and administrators."
      />
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Company & invoicing"
            description="Shown as the sender on every invoice. The IBAN is used for the Swiss QR-bill."
          />
          <CardBody>
            <ActionForm action={saveSettings} className="grid gap-4 sm:grid-cols-3">
              <Field label="Company name" htmlFor="companyName">
                <Input id="companyName" name="companyName" defaultValue={s.companyName} required />
              </Field>
              <Field label="Street and number" htmlFor="street">
                <Input id="street" name="street" defaultValue={s.street ?? ""} />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Postal code" htmlFor="postalCode">
                  <Input id="postalCode" name="postalCode" defaultValue={s.postalCode ?? ""} />
                </Field>
                <Field label="City" htmlFor="city" className="col-span-2">
                  <Input id="city" name="city" defaultValue={s.city ?? ""} />
                </Field>
              </div>
              <Field label="Email (reply-to for invoices)" htmlFor="email">
                <Input id="email" name="email" type="email" defaultValue={s.email ?? ""} />
              </Field>
              <Field label="Phone" htmlFor="phone">
                <Input id="phone" name="phone" defaultValue={s.phone ?? ""} />
              </Field>
              <Field label="Website" htmlFor="website">
                <Input id="website" name="website" defaultValue={s.website ?? ""} />
              </Field>
              <Field
                label="IBAN"
                htmlFor="iban"
                hint="Regular IBAN (SCOR reference) or QR-IBAN (QR reference) – both work."
              >
                <Input
                  id="iban"
                  name="iban"
                  defaultValue={s.iban ?? ""}
                  placeholder="CH93 0076 2011 6238 5295 7"
                />
              </Field>
              <Field
                label="VAT number"
                htmlFor="vatNumber"
                hint="Leave empty if not VAT registered."
              >
                <Input
                  id="vatNumber"
                  name="vatNumber"
                  defaultValue={s.vatNumber ?? ""}
                  placeholder="CHE-123.456.789 MWST"
                />
              </Field>
              <Field
                label="VAT rate (%)"
                htmlFor="vatRateBps"
                hint="0 if not registered, 8.1 standard rate."
              >
                <Input
                  id="vatRateBps"
                  name="vatRateBps"
                  inputMode="decimal"
                  defaultValue={(s.vatRateBps / 100).toString()}
                />
              </Field>
              <Field label="Invoice number prefix" htmlFor="invoicePrefix">
                <Input id="invoicePrefix" name="invoicePrefix" defaultValue={s.invoicePrefix} />
              </Field>
              <Field label="Payment terms (days)" htmlFor="paymentTermsDays">
                <Input
                  id="paymentTermsDays"
                  name="paymentTermsDays"
                  type="number"
                  defaultValue={s.paymentTermsDays}
                />
              </Field>
              <Field
                label="Default commission for new restaurants (%)"
                htmlFor="defaultCommissionBps"
              >
                <Input
                  id="defaultCommissionBps"
                  name="defaultCommissionBps"
                  inputMode="decimal"
                  defaultValue={(s.defaultCommissionBps / 100).toString()}
                />
              </Field>
              <Field label="Default monthly fee (CHF)" htmlFor="defaultMonthlyFeeCents">
                <Input
                  id="defaultMonthlyFeeCents"
                  name="defaultMonthlyFeeCents"
                  inputMode="decimal"
                  defaultValue={formatChf(s.defaultMonthlyFeeCents, { withCurrency: false })}
                />
              </Field>
              <input type="hidden" name="country" value={s.country || "CH"} />
              <Field label="Invoice footer" htmlFor="invoiceFooter" className="sm:col-span-3">
                <Textarea
                  id="invoiceFooter"
                  name="invoiceFooter"
                  defaultValue={s.invoiceFooter ?? ""}
                  rows={2}
                  placeholder="Vielen Dank für die Zusammenarbeit."
                />
              </Field>
              <div className="sm:col-span-3">
                <SubmitButton />
              </div>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Users"
            description="Administrators have full access. Restaurant users are managed on each restaurant's Team tab."
          />
          <CardBody>
            <InviteForm restaurantId={null} roles={[{ value: "admin", label: "Administrator" }]} />
          </CardBody>
          <ul className="divide-y divide-[var(--border)] border-t border-default">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {u.name}{" "}
                    {u.id === me.id ? <span className="text-xs text-muted">(you)</span> : null}
                  </div>
                  <div className="text-xs text-muted">
                    {u.email} · since {formatDate(u.createdAt)}
                  </div>
                </div>
                <Badge tone={u.role === "admin" ? "brand" : "neutral"}>
                  {u.role === "admin" ? "Admin" : "Restaurant user"}
                </Badge>
                {u.id !== me.id ? <PlatformRoleButton userId={u.id} role={u.role} /> : null}
              </li>
            ))}
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{p.email}</div>
                  <div className="text-xs text-muted">
                    Invitation pending · expires {formatDate(p.expiresAt)}
                  </div>
                </div>
                <Badge tone="yellow">admin invite</Badge>
                <RevokeInviteButton id={p.id} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
