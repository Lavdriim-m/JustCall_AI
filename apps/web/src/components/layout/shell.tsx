"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Responsive app shell: fixed sidebar on desktop, slide-over on mobile. */
export function Shell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <div className="min-h-screen lg:pl-64">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-default surface transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {sidebar}
      </aside>
      {open ? (
        <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />
      ) : null}
      <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-default surface px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-md p-1.5 hover:bg-[var(--surface-muted)]"
          aria-label="Menu"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
        <span className="font-semibold">JustCall</span>
      </div>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
