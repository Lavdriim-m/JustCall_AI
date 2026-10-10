import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TabLink } from "@/components/layout/nav-link";
import { RestaurantStatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { getRestaurantAccess } from "@/server/session";

export default async function RestaurantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const access = await getRestaurantAccess(id);
  if (!access) notFound();
  const r = access.restaurant;
  const base = `/admin/restaurants/${r.id}`;
  return (
    <>
      <div className="mb-1 text-sm text-muted">
        <Link href="/admin/restaurants" className="hover:underline">
          Restaurants
        </Link>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{r.name}</h1>
          <RestaurantStatusBadge status={r.status} />
          {!r.acceptingOrders ? (
            <span className="text-xs text-amber-600">Bot paused by restaurant</span>
          ) : null}
        </div>
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/r/${r.slug}/orders`} target="_blank">
            Restaurant portal <ExternalLink />
          </Link>
        </Button>
      </div>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-default">
        <TabLink href={base} exact>
          Overview
        </TabLink>
        <TabLink href={`${base}/menu`}>Menu</TabLink>
        <TabLink href={`${base}/settings`}>Settings</TabLink>
        <TabLink href={`${base}/hours`}>Opening hours</TabLink>
        <TabLink href={`${base}/phone`}>Phone</TabLink>
        <TabLink href={`${base}/billing`}>Billing</TabLink>
        <TabLink href={`${base}/team`}>Team</TabLink>
        <TabLink href={`${base}/activity`}>Calls & orders</TabLink>
        <TabLink href={`${base}/test`}>Test call</TabLink>
      </nav>
      {children}
    </>
  );
}
