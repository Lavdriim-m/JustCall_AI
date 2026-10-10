"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Tag-style input for aliases, tags and allergens. Enter or comma adds a chip. */
export function ChipsInput({
  value,
  onChange,
  placeholder,
  className,
  id,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next);
    setDraft("");
  };
  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-default surface px-2 py-1.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20",
        className,
      )}
    >
      {value.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800 dark:bg-brand-950 dark:text-brand-200"
        >
          {v}
          <button
            type="button"
            onClick={() => onChange(value.filter((x) => x !== v))}
            aria-label={`Remove ${v}`}
            className="opacity-60 hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(e) => {
          if (/[,;]/.test(e.target.value)) add(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/[,;\n]/.test(text)) {
            e.preventDefault();
            add(text);
          }
        }}
        placeholder={value.length ? "" : placeholder}
        className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
      />
    </div>
  );
}
