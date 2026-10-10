"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setOrderBillable, setOrderStatus } from "@/server/actions/orders";

export function OrderAdminActions({
  id,
  status,
  isBillable,
  isTest,
}: {
  id: string;
  status: string;
  isBillable: boolean;
  isTest: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string; message?: string } | undefined>) =>
    start(async () => {
      const res = await fn();
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.message ?? "Updated");
        router.refresh();
      }
    });
  return (
    <div className="flex flex-wrap gap-2">
      {status === "new" ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => setOrderStatus(id, "accepted"))}
        >
          Accept
        </Button>
      ) : null}
      {status === "accepted" ? (
        <Button size="sm" disabled={pending} onClick={() => run(() => setOrderStatus(id, "ready"))}>
          Mark ready
        </Button>
      ) : null}
      {status === "ready" ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => setOrderStatus(id, "completed"))}
        >
          Mark picked up
        </Button>
      ) : null}
      {status !== "cancelled" ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            const reason = prompt("Reason for cancelling?");
            if (reason !== null) run(() => setOrderStatus(id, "cancelled", reason));
          }}
        >
          Cancel order
        </Button>
      ) : null}
      {!isTest ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(() => setOrderBillable(id, !isBillable))}
        >
          {isBillable ? "Exclude from billing" : "Include in billing"}
        </Button>
      ) : null}
    </div>
  );
}
