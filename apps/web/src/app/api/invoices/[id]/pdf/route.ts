import { eq, invoices } from "@justcall/db";
import { invoicePdf } from "@justcall/services";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser, getRestaurantAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Invoice PDF (with Swiss QR-bill). Admins and the restaurant's owners may download it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [inv] = await db
    .select({ restaurantId: invoices.restaurantId, status: invoices.status })
    .from(invoices)
    .where(eq(invoices.id, id))
    .limit(1);
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (user.role !== "admin") {
    const access = await getRestaurantAccess(inv.restaurantId);
    if (!access || access.role === "staff" || inv.status === "draft")
      return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const result = await invoicePdf(db, id);
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(result.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="Rechnung-${result.invoice.number}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
