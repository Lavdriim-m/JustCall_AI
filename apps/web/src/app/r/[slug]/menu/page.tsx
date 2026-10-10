import { requireRestaurantAccess } from "@/server/session";
import { loadEditorMenu } from "@/server/menu-data";
import { AvailabilityBoard } from "@/components/portal/availability";

export const metadata = { title: "Speisekarte" };

export default async function PortalMenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireRestaurantAccess(slug);
  const data = await loadEditorMenu(access.restaurant.id);
  return <AvailabilityBoard restaurantId={access.restaurant.id} data={data} />;
}
