import { notFound } from "next/navigation";
import { getRestaurantAccess } from "@/server/session";
import { HoursEditor } from "@/components/hours-editor";

export default async function HoursPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getRestaurantAccess(id);
  if (!access) notFound();
  const r = access.restaurant;
  return <HoursEditor restaurantId={r.id} weekly={r.openingHours} exceptions={r.hoursExceptions} />;
}
