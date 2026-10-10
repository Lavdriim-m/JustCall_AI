"use client";

import { formatChf } from "@justcall/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { EditorData } from "@/components/menu/types";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { setItemAvailability, setOptionAvailability } from "@/server/actions/menu";

/** Sold-out switches for staff. Changes reach the phone assistant within seconds. */
export function AvailabilityBoard({
  restaurantId,
  data,
}: {
  restaurantId: string;
  data: EditorData;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const toggleItem = (id: string, available: boolean) =>
    start(async () => {
      const res = await setItemAvailability(restaurantId, id, available);
      if (res?.error) toast.error(res.error);
      else toast.success(available ? "Wieder verfügbar" : "Als ausverkauft markiert");
      router.refresh();
    });
  const toggleOption = (id: string, available: boolean) =>
    start(async () => {
      const res = await setOptionAvailability(restaurantId, id, available);
      if (res?.error) toast.error(res.error);
      router.refresh();
    });
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const soldOut = data.items.filter((i) => i.isActive && !i.isAvailable);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Verfügbarkeit</h1>
        <span className="text-sm text-muted">
          Ausverkaufte Artikel bietet der Telefon-Assistent nicht an.
        </span>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suchen…"
          className="ml-auto w-56"
        />
      </div>
      {soldOut.length ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          Ausverkauft: {soldOut.map((i) => i.name).join(", ")}
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {[
          ...data.categories.filter((c) => c.isActive),
          {
            id: null as string | null,
            name: "Weitere",
            description: null,
            sortOrder: 999,
            isActive: true,
          },
        ].map((c) => {
          const items = data.items.filter(
            (i) => i.isActive && i.categoryId === c.id && match(i.name),
          );
          if (!items.length) return null;
          return (
            <Card key={c.id ?? "none"}>
              <CardHeader title={c.name} />
              <ul className="divide-y divide-[var(--border)]">
                {items.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn("font-medium", !i.isAvailable && "text-muted line-through")}
                      >
                        {i.name}
                      </div>
                      <div className="text-xs text-muted">{formatChf(i.priceCents)}</div>
                    </div>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => toggleItem(i.id, !i.isAvailable)}
                      className={cn(
                        "min-w-[120px] rounded-lg px-3 py-2 text-sm font-medium",
                        i.isAvailable
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
                      )}
                    >
                      {i.isAvailable ? "Verfügbar" : "Ausverkauft"}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
        {data.groups.length ? (
          <Card>
            <CardHeader title="Optionen & Beilagen" />
            <ul className="divide-y divide-[var(--border)]">
              {data.groups.flatMap((g) =>
                g.options
                  .filter((o) => match(o.name))
                  .map((o) => (
                    <li key={o.id} className="flex items-center gap-3 px-5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn("font-medium", !o.isAvailable && "text-muted line-through")}
                        >
                          {o.name}
                        </div>
                        <div className="text-xs text-muted">{g.name}</div>
                      </div>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => toggleOption(o.id, !o.isAvailable)}
                        className={cn(
                          "min-w-[120px] rounded-lg px-3 py-2 text-sm font-medium",
                          o.isAvailable
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
                        )}
                      >
                        {o.isAvailable ? "Verfügbar" : "Ausverkauft"}
                      </button>
                    </li>
                  )),
              )}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
