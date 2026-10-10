import { ClipboardList, FileText, PhoneCall, Settings, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { NavLink } from "@/components/layout/nav-link";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { signOutAction } from "@/server/actions/auth";
import { listAccessibleRestaurants, requireRestaurantAccess } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const access = await requireRestaurantAccess(slug);
  const others = await listAccessibleRestaurants(access.user);
  const base = `/r/${access.restaurant.slug}`;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-default surface">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <Link href={base + "/orders"} className="flex items-center gap-3">
            <Logo withText={false} />
            <span className="font-semibold">{access.restaurant.name}</span>
          </Link>
          <nav className="flex flex-1 flex-wrap gap-1">
            <NavLink href={`${base}/orders`}>
              <ClipboardList /> Bestellungen
            </NavLink>
            <NavLink href={`${base}/menu`}>
              <UtensilsCrossed /> Speisekarte
            </NavLink>
            <NavLink href={`${base}/calls`}>
              <PhoneCall /> Anrufe
            </NavLink>
            {access.role !== "staff" ? (
              <NavLink href={`${base}/invoices`}>
                <FileText /> Rechnungen
              </NavLink>
            ) : null}
            <NavLink href={`${base}/settings`}>
              <Settings /> Einstellungen
            </NavLink>
          </nav>
          <div className="flex items-center gap-2 text-sm">
            {access.role === "admin" ? (
              <Link
                href={`/admin/restaurants/${access.restaurant.id}`}
                className="text-muted hover:underline"
              >
                Admin
              </Link>
            ) : others.length > 1 ? (
              <Link href="/" className="text-muted hover:underline">
                Restaurant wechseln
              </Link>
            ) : null}
            <ThemeToggle />
            <form action={signOutAction}>
              <button
                className="rounded-lg px-2 py-1 text-muted hover:bg-[var(--surface-muted)]"
                type="submit"
              >
                Abmelden
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-5">{children}</main>
    </div>
  );
}
