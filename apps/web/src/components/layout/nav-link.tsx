"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({
  href,
  children,
  exact,
  className,
}: {
  href: string;
  children: React.ReactNode;
  exact?: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors [&_svg]:size-4",
        active
          ? "bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200"
          : "text-muted hover:bg-[var(--surface-muted)] hover:text-[var(--text)]",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function TabLink({
  href,
  children,
  exact,
}: {
  href: string;
  children: React.ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-brand-600 text-brand-700 dark:text-brand-300"
          : "border-transparent text-muted hover:text-[var(--text)]",
      )}
    >
      {children}
    </Link>
  );
}
