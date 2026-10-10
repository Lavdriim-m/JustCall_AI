"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setRestaurantStatus } from "@/server/actions/restaurants";

export function StatusActions({
  id,
  status,
  ready,
}: {
  id: string;
  status: string;
  ready: boolean;
}) {
  const [pending, start] = useTransition();
  const set = (next: "draft" | "active" | "paused" | "archived", confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    start(async () => {
      await setRestaurantStatus(id, next);
      toast.success(`Status changed to ${next}`);
    });
  };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        {status === "active"
          ? "The assistant answers calls to this restaurant's number."
          : status === "paused"
            ? "Paused: calls are forwarded directly to the transfer number."
            : status === "archived"
              ? "Archived: calls are not answered."
              : "Draft: calls are not answered yet. Use the test call to try it."}
      </p>
      <div className="flex flex-wrap gap-2">
        {status !== "active" ? (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              set(
                "active",
                ready ? undefined : "The go-live checklist is not complete. Activate anyway?",
              )
            }
          >
            Activate
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => set("paused")}>
            Pause
          </Button>
        )}
        {status !== "draft" && status !== "archived" ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => set("draft")}>
            Back to draft
          </Button>
        ) : null}
        {status !== "archived" ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              set("archived", "Archive this restaurant? Calls will no longer be answered.")
            }
          >
            Archive
          </Button>
        ) : null}
      </div>
    </div>
  );
}
