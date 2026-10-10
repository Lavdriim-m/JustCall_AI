import {
  Building2,
  FileText,
  Gauge,
  Phone,
  PhoneCall,
  Receipt,
  Settings,
  ShoppingBag,
  Activity,
} from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { NavLink } from "@/components/layout/nav-link";
import { Shell } from "@/components/layout/shell";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { requireAdmin } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const sidebar = (
    <>
      <div className="flex h-16 items-center justify-between px-5">
        <Link href="/admin">
          <Logo />
        </Link>
        <ThemeToggle />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        <NavLink href="/admin" exact>
          <Gauge /> Overview
        </NavLink>
        <NavLink href="/admin/restaurants">
          <Building2 /> Restaurants
        </NavLink>
        <NavLink href="/admin/calls">
          <PhoneCall /> Calls
        </NavLink>
        <NavLink href="/admin/orders">
          <ShoppingBag /> Orders
        </NavLink>
        <NavLink href="/admin/invoices">
          <Receipt /> Invoices
        </NavLink>
        <NavLink href="/admin/numbers">
          <Phone /> Phone numbers
        </NavLink>
        <div className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wide text-muted">
          Platform
        </div>
        <NavLink href="/admin/settings">
          <Settings /> Settings
        </NavLink>
        <NavLink href="/admin/system">
          <Activity /> System status
        </NavLink>
        <NavLink href="/admin/docs">
          <FileText /> Guides
        </NavLink>
      </nav>
      <div className="p-3">
        <UserMenu user={user} />
      </div>
    </>
  );
  return <Shell sidebar={sidebar}>{children}</Shell>;
}
