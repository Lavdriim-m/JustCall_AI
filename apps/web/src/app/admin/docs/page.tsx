import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Kbd, PageHeader } from "@/components/ui/misc";

export const metadata = { title: "Guides" };

const steps = [
  {
    title: "1. Create the restaurant",
    body: "Restaurants → New restaurant. Fill in address, contact and the restaurant's public phone number. Set the commission under Billing (default comes from Settings).",
  },
  {
    title: "2. Add the menu",
    body: 'Menu → Import: paste the menu text or upload a photo (AI), or use CSV. Then check every item: add aliases for everything callers say ("Combo 3", "Napoli", "Menü 3"), attach option groups (size, sauce, drink) and mark defaults. Use the "Test what callers might say" box.',
  },
  {
    title: "3. Opening hours, ordering & payment",
    body: "Set opening hours (incl. late-night ranges and holidays), pickup/delivery, preparation time, delivery area and payment methods (cash / card / TWINT + optional TWINT link).",
  },
  {
    title: "4. Safety & transfer number",
    body: "Enter the owner's mobile (or a second line) as transfer number. Calls mentioning allergies and requests for the owner are transferred there. It must not be the forwarded public number.",
  },
  {
    title: "5. Test call",
    body: "Test call tab: run through a full order in text mode, then in voice mode with a headset. Check the SMS preview and the order on the restaurant portal.",
  },
  {
    title: "6. Connect the phone number",
    body: "Phone tab: connect a Twilio number (webhooks are configured automatically). Ask the restaurant to forward its number: overflow (busy / no answer) or always – codes are shown on the Phone tab.",
  },
  {
    title: "7. Invite the restaurant & go live",
    body: "Team tab: invite the owner and staff. They get the live orders board (tablet at the counter, with sound), sold-out toggles and rush-hour waiting time. Then click Activate on the Overview tab.",
  },
];

export default function DocsPage() {
  return (
    <>
      <PageHeader
        title="Guides"
        description="Onboarding a restaurant in about 30 minutes, and how everything fits together."
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {steps.map((s) => (
            <Card key={s.title}>
              <CardBody>
                <div className="font-medium">{s.title}</div>
                <p className="mt-1 text-sm text-muted">{s.body}</p>
              </CardBody>
            </Card>
          ))}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="How a call works" />
            <CardBody className="space-y-2 text-sm text-muted">
              <p>
                Caller dials the restaurant → forwarded to the JustCall number (Twilio) → voice
                server streams audio to speech recognition (Swiss German) → the AI assistant uses
                tools for every step (add items, check opening hours, compute prices) → replies are
                spoken with a Swiss voice.
              </p>
              <p>
                Prices, totals, opening hours, order numbers and the allergy rule are enforced by
                the server – the AI cannot invent them.
              </p>
              <p>
                After the confirmation the order appears instantly on the restaurant&apos;s orders
                board and the caller receives an SMS with order number, total and payment
                instructions.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Useful commands" />
            <CardBody className="space-y-2 text-sm">
              <p>
                <Kbd>pnpm doctor</Kbd> – checks every integration with a real request.
              </p>
              <p>
                <Kbd>pnpm --filter @justcall/voice chat</Kbd> – talk to a restaurant&apos;s
                assistant in the terminal.
              </p>
              <p>
                <Kbd>pnpm eval</Kbd> – runs scripted Swiss German test conversations against the
                configured model.
              </p>
              <p>
                <Kbd>pnpm db:migrate</Kbd> – applies database migrations.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="More" />
            <CardBody className="space-y-1 text-sm">
              <p>
                Full documentation lives in the repository under{" "}
                <span className="font-mono">docs/</span>: SETUP (external services), DEPLOYMENT,
                ARCHITECTURE, CONVERSATION_DESIGN and OPERATIONS.
              </p>
              <Link href="/admin/system" className="text-brand-700 underline dark:text-brand-300">
                System status
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
