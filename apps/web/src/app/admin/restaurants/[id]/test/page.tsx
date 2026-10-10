import { notFound } from "next/navigation";
import { Simulator } from "@/components/simulator/simulator";
import { getRestaurantAccess } from "@/server/session";

export default async function TestCallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getRestaurantAccess(id);
  if (!access) notFound();
  return <Simulator restaurantId={access.restaurant.id} />;
}
