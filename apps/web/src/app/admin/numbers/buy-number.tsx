"use client";

import { formatSwissNumber } from "@justcall/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { buyNumberAction, searchNumbersAction } from "@/server/actions/phone";

type Found = { phoneNumber: string; locality: string | null; region: string | null };

export function BuyNumber({ restaurants }: { restaurants: { id: string; name: string }[] }) {
  const router = useRouter();
  const [contains, setContains] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [restaurantId, setRestaurantId] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input
          value={contains}
          onChange={(e) => setContains(e.target.value)}
          placeholder="Local number containing, e.g. 4144"
          className="w-56"
        />
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await searchNumbersAction({
                // Swiss national format (044 …) → E.164 digits (4144 …), as Twilio searches those.
                contains: contains.replace(/\D/g, "").replace(/^0(?=\d)/, "41") || undefined,
              });
              if (res?.error) toast.error(res.error);
              else setResults((res?.data as Found[]) ?? []);
            })
          }
        >
          Search
        </Button>
        <Select
          value={restaurantId}
          onChange={(e) => setRestaurantId(e.target.value)}
          className="w-56"
        >
          <option value="">Assign later</option>
          {restaurants.map((r) => (
            <option key={r.id} value={r.id}>
              Assign to {r.name}
            </option>
          ))}
        </Select>
      </div>
      {results.length ? (
        <ul className="divide-y divide-[var(--border)] rounded-lg border border-default">
          {results.map((n) => (
            <li key={n.phoneNumber} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>
                <span className="font-medium">{formatSwissNumber(n.phoneNumber)}</span>{" "}
                <span className="text-muted">
                  {[n.locality, n.region].filter(Boolean).join(", ")}
                </span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  confirm(`Buy ${n.phoneNumber}? Twilio charges a monthly fee.`) &&
                  start(async () => {
                    const res = await buyNumberAction(n.phoneNumber, restaurantId || null);
                    if (res?.error) toast.error(res.error);
                    else {
                      toast.success(res?.message ?? "Purchased");
                      router.refresh();
                    }
                  })
                }
              >
                Buy
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
