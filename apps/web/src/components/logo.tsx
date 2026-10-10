import { cn } from "@/lib/utils";

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 64 64" className="size-7 shrink-0" aria-hidden>
        <rect width="64" height="64" rx="14" className="fill-brand-600" />
        <path
          d="M22 18c2-2 5-2 6 1l3 7c1 2 0 4-2 5l-3 2c2 5 6 9 11 11l2-3c1-2 3-3 5-2l7 3c3 1 3 4 1 6l-3 3c-3 3-8 3-12 1-9-4-16-11-20-20-2-4-2-9 1-12z"
          fill="#fff"
        />
      </svg>
      {withText ? <span className="text-lg">JustCall</span> : null}
    </span>
  );
}
