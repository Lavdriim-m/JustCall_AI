import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/misc";
import { createRestaurant } from "@/server/actions/restaurants";

export const metadata = { title: "New restaurant" };

export default function NewRestaurantPage() {
  return (
    <>
      <PageHeader
        title="New restaurant"
        breadcrumb={<Link href="/admin/restaurants">Restaurants</Link>}
        description="Start with the basics – you can configure the menu, hours, phone number and billing afterwards."
      />
      <Card className="max-w-2xl">
        <CardBody>
          <ActionForm action={createRestaurant} className="grid gap-4 sm:grid-cols-2">
            <Field label="Restaurant name" htmlFor="name" className="sm:col-span-2">
              <Input id="name" name="name" required placeholder="Pizzeria Bella Vista" autoFocus />
            </Field>
            <Field label="City" htmlFor="city">
              <Input id="city" name="city" placeholder="Zürich" />
            </Field>
            <Field
              label="Public phone number"
              htmlFor="publicPhone"
              hint="The number customers dial today."
            >
              <Input id="publicPhone" name="publicPhone" placeholder="044 123 45 67" />
            </Field>
            <Field label="Contact person" htmlFor="contactName">
              <Input id="contactName" name="contactName" />
            </Field>
            <Field label="Contact email" htmlFor="contactEmail">
              <Input id="contactEmail" name="contactEmail" type="email" />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton>Create restaurant</SubmitButton>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
