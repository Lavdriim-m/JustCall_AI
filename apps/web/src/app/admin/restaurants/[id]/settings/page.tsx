import { defaultGreeting, formatChf } from "@justcall/core";
import { toRestaurantProfile } from "@justcall/db";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea, Toggle } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { updateRestaurant } from "@/server/actions/restaurants";
import { getRestaurantAccess } from "@/server/session";
import { VoicePreview } from "./voice-preview";

const chf = (c: number) => formatChf(c, { withCurrency: false });

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getRestaurantAccess(id);
  if (!access) notFound();
  const r = access.restaurant;
  const action = (section: Parameters<typeof updateRestaurant>[1]) =>
    updateRestaurant.bind(null, r.id, section);

  return (
    <div className="space-y-6">
      <Card id="general">
        <CardHeader title="General" description="Name, address and contact details." />
        <CardBody>
          <ActionForm action={action("general")} className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name">
              <Input id="name" name="name" defaultValue={r.name} required />
            </Field>
            <Field label="Slug" htmlFor="slug" hint="Used in the restaurant portal URL.">
              <Input id="slug" name="slug" defaultValue={r.slug} required />
            </Field>
            <Field label="Legal name" htmlFor="legalName">
              <Input id="legalName" name="legalName" defaultValue={r.legalName ?? ""} />
            </Field>
            <Field label="Street and number" htmlFor="street">
              <Input id="street" name="street" defaultValue={r.street ?? ""} />
            </Field>
            <Field label="Postal code" htmlFor="postalCode">
              <Input id="postalCode" name="postalCode" defaultValue={r.postalCode ?? ""} />
            </Field>
            <Field label="City" htmlFor="city">
              <Input id="city" name="city" defaultValue={r.city ?? ""} />
            </Field>
            <Field
              label="Public phone number"
              htmlFor="publicPhone"
              hint="The restaurant's existing number (forwarded to JustCall)."
            >
              <Input id="publicPhone" name="publicPhone" defaultValue={r.publicPhone ?? ""} />
            </Field>
            <Field label="Contact person" htmlFor="contactName">
              <Input id="contactName" name="contactName" defaultValue={r.contactName ?? ""} />
            </Field>
            <Field label="Contact email" htmlFor="contactEmail">
              <Input
                id="contactEmail"
                name="contactEmail"
                type="email"
                defaultValue={r.contactEmail ?? ""}
              />
            </Field>
            <Field label="Contact phone" htmlFor="contactPhone">
              <Input id="contactPhone" name="contactPhone" defaultValue={r.contactPhone ?? ""} />
            </Field>
            <Field label="Internal notes" htmlFor="notes" className="sm:col-span-2">
              <Textarea
                id="notes"
                name="notes"
                defaultValue={r.notes ?? ""}
                placeholder="Deal details, contact history…"
              />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton />
            </div>
          </ActionForm>
        </CardBody>
      </Card>

      <Card id="bot">
        <CardHeader
          title="Voice assistant"
          description="How the assistant introduces itself and speaks."
        />
        <CardBody>
          <ActionForm action={action("bot")} className="grid gap-4 sm:grid-cols-2">
            <Field label="Assistant name" htmlFor="botName">
              <Input id="botName" name="botName" defaultValue={r.botName} required />
            </Field>
            <Field
              label="Speaking style"
              htmlFor="speechStyle"
              hint="Swiss High German is understood by everyone and sounds most natural with today's voices."
            >
              <Select id="speechStyle" name="speechStyle" defaultValue={r.speechStyle}>
                <option value="swiss_standard">Swiss High German (recommended)</option>
                <option value="swiss_dialect">Swiss German dialect (experimental)</option>
              </Select>
            </Field>
            <Field
              label="Greeting"
              htmlFor="greeting"
              className="sm:col-span-2"
              hint={`Leave empty for the default: "${defaultGreeting({ ...toRestaurantProfile(r), greeting: null })}". Placeholders: {restaurant}, {bot}.`}
            >
              <Textarea id="greeting" name="greeting" defaultValue={r.greeting ?? ""} rows={2} />
            </Field>
            <Field
              label="Restaurant-specific instructions"
              htmlFor="customInstructions"
              className="sm:col-span-2"
              hint="Facts and preferences for the assistant, e.g. 'Family pizzas are 40 cm.', 'Recommend the daily special.' Safety rules always take priority."
            >
              <Textarea
                id="customInstructions"
                name="customInstructions"
                defaultValue={r.customInstructions ?? ""}
                rows={4}
              />
            </Field>
            <Field
              label="Voice provider"
              htmlFor="ttsProvider"
              hint="Empty = server default (TTS_PROVIDER)."
            >
              <Select id="ttsProvider" name="ttsProvider" defaultValue={r.ttsProvider ?? ""}>
                <option value="">Server default</option>
                <option value="polly">Amazon Polly</option>
                <option value="azure">Azure Speech</option>
                <option value="elevenlabs">ElevenLabs</option>
                <option value="openai">OpenAI</option>
              </Select>
            </Field>
            <Field
              label="Voice"
              htmlFor="ttsVoice"
              hint="Polly: Sabrina · Azure: de-CH-LeniNeural, de-CH-JanNeural · ElevenLabs: voice ID · OpenAI: coral, alloy …"
            >
              <Input
                id="ttsVoice"
                name="ttsVoice"
                defaultValue={r.ttsVoice ?? ""}
                placeholder="Server default"
              />
            </Field>
            <Field
              label="Speech recognition"
              htmlFor="sttProvider"
              hint="Empty = server default (STT_PROVIDER)."
            >
              <Select id="sttProvider" name="sttProvider" defaultValue={r.sttProvider ?? ""}>
                <option value="">Server default</option>
                <option value="aws">Amazon Transcribe (de-CH)</option>
                <option value="azure">Azure Speech (de-CH)</option>
                <option value="openai">OpenAI</option>
              </Select>
            </Field>
            <Field
              label="Language model"
              htmlFor="llmModel"
              hint="Empty = server default (OPENAI_MODEL / ANTHROPIC_MODEL)."
            >
              <Input
                id="llmModel"
                name="llmModel"
                defaultValue={r.llmModel ?? ""}
                placeholder="e.g. gpt-5.4-mini"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <SubmitButton />
              <VoicePreview
                provider={r.ttsProvider}
                voice={r.ttsVoice}
                text={defaultGreeting(toRestaurantProfile(r))}
              />
            </div>
          </ActionForm>
        </CardBody>
      </Card>

      <Card id="ordering">
        <CardHeader title="Ordering" description="Pickup, delivery and timing." />
        <CardBody>
          <ActionForm action={action("ordering")} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3 sm:col-span-2">
              <Toggle
                name="acceptingOrders"
                defaultChecked={r.acceptingOrders}
                label="Assistant takes orders"
                hint="When off, calls go straight to the transfer number."
              />
              <Toggle name="pickupEnabled" defaultChecked={r.pickupEnabled} label="Pickup" />
              <Toggle name="deliveryEnabled" defaultChecked={r.deliveryEnabled} label="Delivery" />
              <Toggle
                name="allowPreorders"
                defaultChecked={r.allowPreorders}
                label="Pre-orders"
                hint="Accept orders for later today, also while closed (within 24 hours)."
              />
            </div>
            <Field label="Preparation time (minutes)" htmlFor="prepTimeMinutes">
              <Input
                id="prepTimeMinutes"
                name="prepTimeMinutes"
                type="number"
                min={0}
                defaultValue={r.prepTimeMinutes}
              />
            </Field>
            <Field
              label="Extra waiting time (minutes)"
              htmlFor="extraWaitMinutes"
              hint="Rush hour buffer – restaurants can change it in their portal."
            >
              <Input
                id="extraWaitMinutes"
                name="extraWaitMinutes"
                type="number"
                min={0}
                defaultValue={r.extraWaitMinutes}
              />
            </Field>
            <Field label="Delivery time (minutes)" htmlFor="deliveryTimeMinutes">
              <Input
                id="deliveryTimeMinutes"
                name="deliveryTimeMinutes"
                type="number"
                min={0}
                defaultValue={r.deliveryTimeMinutes}
              />
            </Field>
            <Field
              label="Max. quantity per item"
              htmlFor="maxItemQuantity"
              hint="Larger orders are transferred to staff."
            >
              <Input
                id="maxItemQuantity"
                name="maxItemQuantity"
                type="number"
                min={1}
                defaultValue={r.maxItemQuantity}
              />
            </Field>
            <Field label="Delivery fee (CHF)" htmlFor="deliveryFeeCents">
              <Input
                id="deliveryFeeCents"
                name="deliveryFeeCents"
                inputMode="decimal"
                defaultValue={chf(r.deliveryFeeCents)}
              />
            </Field>
            <Field label="Minimum order for delivery (CHF)" htmlFor="deliveryMinOrderCents">
              <Input
                id="deliveryMinOrderCents"
                name="deliveryMinOrderCents"
                inputMode="decimal"
                defaultValue={chf(r.deliveryMinOrderCents)}
              />
            </Field>
            <Field
              label="Delivery area (postal codes)"
              htmlFor="deliveryPostalCodes"
              className="sm:col-span-2"
              hint="Comma separated. Empty = no restriction."
            >
              <Input
                id="deliveryPostalCodes"
                name="deliveryPostalCodes"
                defaultValue={r.deliveryPostalCodes.join(", ")}
                placeholder="8003, 8004, 8005"
              />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton />
            </div>
          </ActionForm>
        </CardBody>
      </Card>

      <Card id="payment">
        <CardHeader
          title="Payment"
          description="How customers pay. The confirmation SMS includes these instructions."
        />
        <CardBody>
          <ActionForm action={action("payment")} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3 sm:col-span-2">
              <Toggle
                name="paymentMethods[]"
                value="cash"
                defaultChecked={r.paymentMethods.includes("cash")}
                label="Cash at the counter"
              />
              <Toggle
                name="paymentMethods[]"
                value="card"
                defaultChecked={r.paymentMethods.includes("card")}
                label="Card at the counter"
              />
              <Toggle
                name="paymentMethods[]"
                value="twint"
                defaultChecked={r.paymentMethods.includes("twint")}
                label="TWINT"
              />
            </div>
            <Field
              label="TWINT payment link (optional)"
              htmlFor="twintPaymentUrl"
              hint="Sent in the SMS when the customer pays with TWINT."
            >
              <Input
                id="twintPaymentUrl"
                name="twintPaymentUrl"
                type="url"
                defaultValue={r.twintPaymentUrl ?? ""}
                placeholder="https://…"
              />
            </Field>
            <Field
              label="Payment note (optional)"
              htmlFor="paymentNote"
              hint="e.g. 'Bitte Bestellnummer bei TWINT angeben.'"
            >
              <Input id="paymentNote" name="paymentNote" defaultValue={r.paymentNote ?? ""} />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton />
            </div>
          </ActionForm>
        </CardBody>
      </Card>

      <Card id="safety">
        <CardHeader
          title="Safety & transfers"
          description="Allergies and requests for a person are handed to the restaurant."
        />
        <CardBody>
          {!r.transferPhone ? (
            <Notice tone="warning" className="mb-4" title="No transfer number">
              Without a transfer number, callers with allergies cannot be helped and owner requests
              cannot be connected.
            </Notice>
          ) : null}
          <ActionForm action={action("safety")} className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Transfer number"
              htmlFor="transferPhone"
              hint="Mobile of the owner or a second line. Must NOT be the forwarded public number (call loop)."
            >
              <Input
                id="transferPhone"
                name="transferPhone"
                defaultValue={r.transferPhone ?? ""}
                placeholder="079 123 45 67"
              />
            </Field>
            <div className="space-y-3 sm:col-span-2">
              <Toggle
                name="allergyQuestionEnabled"
                defaultChecked={r.allergyQuestionEnabled}
                label="Ask about allergies at the start of every order"
              />
              <Toggle
                name="transferOnAllergy"
                defaultChecked={r.transferOnAllergy}
                label="Transfer calls that mention allergies or intolerances"
                hint="Strongly recommended. The assistant never gives allergen advice."
              />
              <Toggle
                name="transferOnOwnerRequest"
                defaultChecked={r.transferOnOwnerRequest}
                label="Transfer when a caller asks for the owner or a person"
              />
            </div>
            <div className="sm:col-span-2">
              <SubmitButton />
            </div>
          </ActionForm>
        </CardBody>
      </Card>

      <Card id="notifications">
        <CardHeader
          title="Notifications"
          description="Confirmation SMS to the customer and emails to the restaurant."
        />
        <CardBody>
          <ActionForm action={action("notifications")} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Toggle
                name="smsEnabled"
                defaultChecked={r.smsEnabled}
                label="Send order confirmation SMS to mobile callers"
              />
            </div>
            <Field
              label="SMS sender name"
              htmlFor="smsSenderName"
              hint="Max. 11 characters, letters and digits (e.g. BellaVista). Empty = platform default."
            >
              <Input
                id="smsSenderName"
                name="smsSenderName"
                defaultValue={r.smsSenderName ?? ""}
                maxLength={15}
              />
            </Field>
            <Field
              label="Email for new orders (optional)"
              htmlFor="orderNotificationEmails"
              hint="Comma separated. The live orders board is the primary channel."
            >
              <Input
                id="orderNotificationEmails"
                name="orderNotificationEmails"
                defaultValue={r.orderNotificationEmails.join(", ")}
              />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton />
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}
