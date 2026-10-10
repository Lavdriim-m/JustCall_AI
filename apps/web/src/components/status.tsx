import { Badge } from "@/components/ui/badge";

type Tone = "neutral" | "green" | "yellow" | "red" | "blue" | "brand" | "purple";

const CALL_OUTCOMES: Record<string, { label: string; tone: Tone }> = {
  order_placed: { label: "Order placed", tone: "green" },
  transferred_allergy: { label: "Transferred · allergy", tone: "yellow" },
  transferred_owner: { label: "Transferred · owner", tone: "blue" },
  transferred_other: { label: "Transferred", tone: "blue" },
  no_order: { label: "No order", tone: "neutral" },
  closed: { label: "Closed", tone: "neutral" },
  paused: { label: "Bot paused", tone: "neutral" },
  error: { label: "Error", tone: "red" },
};

export function CallOutcomeBadge({ outcome, status }: { outcome: string | null; status?: string }) {
  if (!outcome) {
    if (status === "in_progress" || status === "ringing") {
      return (
        <Badge tone="brand">
          <span className="size-1.5 rounded-full bg-brand-500 pulse-ring" /> Live
        </Badge>
      );
    }
    if (status === "failed") return <Badge tone="red">Failed</Badge>;
    return <Badge>–</Badge>;
  }
  const o = CALL_OUTCOMES[outcome] ?? { label: outcome, tone: "neutral" as Tone };
  return <Badge tone={o.tone}>{o.label}</Badge>;
}

const ORDER_STATUS: Record<string, { label: string; de: string; tone: Tone }> = {
  new: { label: "New", de: "Neu", tone: "brand" },
  accepted: { label: "Accepted", de: "In Zubereitung", tone: "blue" },
  ready: { label: "Ready", de: "Bereit", tone: "purple" },
  completed: { label: "Completed", de: "Abgeholt", tone: "green" },
  cancelled: { label: "Cancelled", de: "Storniert", tone: "red" },
};

export function OrderStatusBadge({ status, lang = "en" }: { status: string; lang?: "en" | "de" }) {
  const s = ORDER_STATUS[status] ?? { label: status, de: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone}>{lang === "de" ? s.de : s.label}</Badge>;
}

const RESTAURANT_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "green" },
  paused: { label: "Paused", tone: "yellow" },
  archived: { label: "Archived", tone: "neutral" },
};

export function RestaurantStatusBadge({ status }: { status: string }) {
  const s = RESTAURANT_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "blue" },
  paid: { label: "Paid", tone: "green" },
  void: { label: "Void", tone: "red" },
};

export function InvoiceStatusBadge({ status }: { status: string }) {
  const s = INVOICE_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
