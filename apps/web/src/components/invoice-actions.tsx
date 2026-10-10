"use client";

import { FileText, Mail, Ban, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  generateInvoicesAction,
  sendInvoiceAction,
  setInvoiceStatus,
} from "@/server/actions/invoices";

function lastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function GenerateInvoiceButton({ restaurantId }: { restaurantId?: string }) {
  const router = useRouter();
  const [month, setMonth] = useState(lastMonth());
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Input
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        className="h-8 w-[150px]"
        aria-label="Month"
      />
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await generateInvoicesAction(month, restaurantId);
            if (res?.error) toast.error(res.error);
            else {
              toast.success(res?.message ?? "Done");
              router.refresh();
            }
          })
        }
      >
        <FileText />{" "}
        {pending
          ? "Generating…"
          : restaurantId
            ? "Generate invoice"
            : "Generate for all restaurants"}
      </Button>
    </div>
  );
}

export function InvoiceDetailActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (
    fn: () => Promise<{ ok?: boolean; error?: string; message?: string } | undefined>,
    confirmText?: string,
  ) => {
    if (confirmText && !confirm(confirmText)) return;
    start(async () => {
      const res = await fn();
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.message ?? "Done");
        router.refresh();
      }
    });
  };
  if (status === "void") return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="secondary">
        <a href={`/api/invoices/${id}/pdf`} target="_blank" rel="noreferrer">
          <FileText /> PDF
        </a>
      </Button>
      <Button
        disabled={pending}
        onClick={() =>
          run(
            () => sendInvoiceAction(id),
            status === "sent" || status === "paid" ? "Send this invoice again?" : undefined,
          )
        }
      >
        <Mail /> {status === "draft" ? "Send by email" : "Resend"}
      </Button>
      {status !== "paid" ? (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => setInvoiceStatus(id, "paid"))}
        >
          <CheckCircle2 /> Mark as paid
        </Button>
      ) : null}
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() =>
          run(() => setInvoiceStatus(id, "void"), "Void this invoice? This cannot be undone.")
        }
      >
        <Ban /> Void
      </Button>
    </div>
  );
}
