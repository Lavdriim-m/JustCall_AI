import * as React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-1 text-sm text-muted">{breadcrumb}</div> : null}
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warning" | "error" | "success";
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200",
    warning:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
    error:
      "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200",
    success:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
  };
  return (
    <div className={cn("rounded-lg border px-4 py-3 text-sm", tones[tone], className)}>
      {title ? <div className="font-medium">{title}</div> : null}
      {children ? <div className={cn(title && "mt-1")}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? (
        <div className="mb-3 rounded-full bg-brand-50 p-3 text-brand-600 dark:bg-brand-950 [&_svg]:size-6">
          {icon}
        </div>
      ) : null}
      <div className="font-medium">{title}</div>
      {children ? <div className="mt-1 max-w-md text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-default surface-muted px-1.5 py-0.5 font-mono text-xs">
      {children}
    </kbd>
  );
}
