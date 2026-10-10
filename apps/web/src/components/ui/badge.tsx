import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
        yellow: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
        red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
        blue: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
        brand: "bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-300",
        purple: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
