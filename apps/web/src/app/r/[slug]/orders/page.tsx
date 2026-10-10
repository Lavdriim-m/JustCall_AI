import { OrdersBoard } from "@/components/portal/orders-board";
import { requireRestaurantAccess } from "@/server/session";

export const metadata = { title: "Bestellungen" };

export default async function OrdersBoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireRestaurantAccess(slug);
  const r = access.restaurant;
  return (
    <OrdersBoard
      slug={r.slug}
      restaurantId={r.id}
      timezone={r.timezone}
      initialAccepting={r.acceptingOrders}
      initialExtraWait={r.extraWaitMinutes}
      prepTime={r.prepTimeMinutes}
    />
  );
}
