import { notFound } from "next/navigation";
import { MenuEditor } from "@/components/menu/menu-editor";
import { getRestaurantAccess } from "@/server/session";
import { loadEditorMenu } from "@/server/menu-data";

export default async function MenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getRestaurantAccess(id);
  if (!access) notFound();
  const data = await loadEditorMenu(access.restaurant.id);
  const aiAvailable = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 20);
  return <MenuEditor restaurantId={access.restaurant.id} data={data} aiAvailable={aiAvailable} />;
}
