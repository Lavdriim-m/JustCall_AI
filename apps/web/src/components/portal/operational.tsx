"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { setOperationalState } from "@/server/actions/restaurants";

export function PortalOperational({
  restaurantId,
  accepting: initialAccepting,
  extraWait: initialWait,
  prepTime,
}: {
  restaurantId: string;
  accepting: boolean;
  extraWait: number;
  prepTime: number;
}) {
  const [accepting, setAccepting] = useState(initialAccepting);
  const [extraWait, setExtraWait] = useState(initialWait);
  const [pending, start] = useTransition();
  const save = (patch: { acceptingOrders?: boolean; extraWaitMinutes?: number }) =>
    start(async () => {
      await setOperationalState(restaurantId, patch);
      if (patch.acceptingOrders !== undefined) setAccepting(patch.acceptingOrders);
      if (patch.extraWaitMinutes !== undefined) setExtraWait(patch.extraWaitMinutes);
      toast.success("Gespeichert");
    });
  return (
    <Card>
      <CardHeader
        title="Telefon-Assistent"
        description="Pausieren Sie den Assistenten, wenn Sie keine Bestellungen mehr annehmen können. Anrufe werden dann direkt an Ihre Weiterleitungsnummer verbunden."
      />
      <CardBody className="flex flex-wrap items-center gap-6">
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => save({ acceptingOrders: true })}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium",
              accepting ? "bg-emerald-600 text-white" : "border border-default",
            )}
          >
            Aktiv
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => save({ acceptingOrders: false })}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium",
              !accepting ? "bg-amber-500 text-white" : "border border-default",
            )}
          >
            Pausiert
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Zusätzliche Wartezeit (Stosszeit):</span>
          {[0, 10, 20, 30, 45, 60].map((m) => (
            <button
              key={m}
              type="button"
              disabled={pending}
              onClick={() => save({ extraWaitMinutes: m })}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium",
                extraWait === m ? "bg-brand-600 text-white" : "border border-default",
              )}
            >
              {m === 0 ? "keine" : `+${m} Min.`}
            </button>
          ))}
          <span className="text-muted">→ Abholung frühestens nach {prepTime + extraWait} Min.</span>
        </div>
      </CardBody>
    </Card>
  );
}
