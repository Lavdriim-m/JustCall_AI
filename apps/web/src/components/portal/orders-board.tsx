"use client";

import {
  PAYMENT_LABELS_DE,
  formatChf,
  formatSwissNumber,
  type PaymentMethod,
} from "@justcall/core";
import { Bell, BellOff, Bike, Clock, Phone, ShoppingBag, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { setOrderStatus } from "@/server/actions/orders";
import { setOperationalState } from "@/server/actions/restaurants";

type BoardOrder = {
  id: string;
  orderNumber: number;
  orderDate: string;
  status: "new" | "accepted" | "ready" | "completed" | "cancelled";
  fulfillment: "pickup" | "delivery";
  requestedFor: string | null;
  estimatedReadyAt: string | null;
  customerName: string;
  customerPhone: string | null;
  deliveryAddress: { street: string; postalCode?: string; city?: string; notes?: string } | null;
  paymentMethod: string | null;
  notes: string | null;
  totalCents: number;
  isTest: boolean;
  createdAt: string;
  items: { id: string; name: string; quantity: number; options: string[]; notes: string | null }[];
};

const COLUMNS: { status: BoardOrder["status"]; title: string; tone: string }[] = [
  { status: "new", title: "Neu", tone: "border-t-brand-500" },
  { status: "accepted", title: "In Zubereitung", tone: "border-t-sky-500" },
  { status: "ready", title: "Bereit zur Abholung", tone: "border-t-violet-500" },
];

function beep(ctx: AudioContext) {
  const now = ctx.currentTime;
  for (const [i, freq] of [880, 1175, 1568].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, now + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.4, now + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.17);
  }
}

export function OrdersBoard({
  slug,
  restaurantId,
  timezone,
  initialAccepting,
  initialExtraWait,
  prepTime,
}: {
  slug: string;
  restaurantId: string;
  timezone: string;
  initialAccepting: boolean;
  initialExtraWait: number;
  prepTime: number;
}) {
  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [online, setOnline] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [accepting, setAccepting] = useState(initialAccepting);
  const [extraWait, setExtraWait] = useState(initialExtraWait);
  const [soundOn, setSoundOn] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [showDone, setShowDone] = useState(false);
  const [pending, start] = useTransition();
  const known = useRef<Set<string> | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/r/${slug}/orders`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        orders: BoardOrder[];
        restaurant: { acceptingOrders: boolean; extraWaitMinutes: number };
      };
      setOnline(true);
      setLoaded(true);
      setAccepting(data.restaurant.acceptingOrders);
      setExtraWait(data.restaurant.extraWaitMinutes);
      const fresh = data.orders.filter(
        (o) => o.status === "new" && known.current && !known.current.has(o.id),
      );
      if (fresh.length) {
        if (audioCtx.current) beep(audioCtx.current);
        for (const o of fresh)
          toast.success(`Neue Bestellung Nr. ${o.orderNumber} – ${o.customerName}`, {
            duration: 8000,
          });
        if (document.hidden) document.title = `(${fresh.length}) Neue Bestellung`;
      }
      known.current = new Set(data.orders.map((o) => o.id));
      setOrders(data.orders);
    } catch {
      setOnline(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
    const poll = setInterval(load, 4000);
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    const onVisible = () => {
      if (!document.hidden) document.title = "Bestellungen · JustCall";
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const enableSound = () => {
    audioCtx.current ??= new AudioContext();
    void audioCtx.current.resume();
    beep(audioCtx.current);
    setSoundOn(true);
  };

  const move = (order: BoardOrder, status: BoardOrder["status"], reason?: string) =>
    start(async () => {
      setOrders((all) => all.map((o) => (o.id === order.id ? { ...o, status } : o)));
      const res = await setOrderStatus(order.id, status, reason);
      if (res?.error) toast.error(res.error);
      void load();
    });

  const operational = (patch: { acceptingOrders?: boolean; extraWaitMinutes?: number }) =>
    start(async () => {
      if (patch.acceptingOrders !== undefined) setAccepting(patch.acceptingOrders);
      if (patch.extraWaitMinutes !== undefined) setExtraWait(patch.extraWaitMinutes);
      await setOperationalState(restaurantId, patch);
      toast.success(
        patch.acceptingOrders === false
          ? "Assistent pausiert – Anrufe gehen direkt an Ihre Weiterleitungsnummer"
          : patch.acceptingOrders === true
            ? "Assistent nimmt wieder Bestellungen an"
            : `Zusätzliche Wartezeit: ${patch.extraWaitMinutes} Min.`,
      );
    });

  const byStatus = useMemo(() => {
    const map = new Map<string, BoardOrder[]>();
    for (const o of orders) {
      const list = map.get(o.status) ?? [];
      list.push(o);
      map.set(o.status, list);
    }
    for (const list of map.values()) list.sort((a, b) => dueTime(a) - dueTime(b));
    return map;
  }, [orders]);
  const done = [...(byStatus.get("completed") ?? []), ...(byStatus.get("cancelled") ?? [])].sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-default surface p-3">
        <button
          type="button"
          onClick={() => operational({ acceptingOrders: !accepting })}
          disabled={pending}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
            accepting
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
          )}
        >
          <span
            className={cn(
              "size-2.5 rounded-full",
              accepting ? "bg-emerald-500 pulse-ring" : "bg-amber-500",
            )}
          />
          {accepting ? "Telefon-Assistent aktiv" : "Assistent pausiert"}
        </button>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <Clock className="size-4 text-muted" />
          <span className="text-muted">Wartezeit:</span>
          {[0, 10, 20, 30, 45].map((m) => (
            <button
              key={m}
              type="button"
              disabled={pending}
              onClick={() => operational({ extraWaitMinutes: m })}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm font-medium",
                extraWait === m
                  ? "bg-brand-600 text-white"
                  : "border border-default hover:bg-[var(--surface-muted)]",
              )}
            >
              {m === 0 ? `${prepTime} Min.` : `+${m}`}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {online ? (
            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <Wifi className="size-4" /> Live
            </span>
          ) : (
            <span className="flex items-center gap-1 text-red-600">
              <WifiOff className="size-4" /> Keine Verbindung
            </span>
          )}
          <Button
            size="sm"
            variant={soundOn ? "secondary" : "default"}
            onClick={soundOn ? () => setSoundOn(false) : enableSound}
          >
            {soundOn ? <Bell /> : <BellOff />} {soundOn ? "Ton an" : "Ton aktivieren"}
          </Button>
        </div>
      </div>

      {!loaded ? <p className="text-sm text-muted">Lade Bestellungen…</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const list = byStatus.get(col.status) ?? [];
          return (
            <section
              key={col.status}
              className={cn(
                "min-h-[120px] rounded-xl border border-t-4 lg:min-h-[300px] border-default bg-[var(--surface-muted)]/60 p-3",
                col.tone,
              )}
            >
              <h2 className="mb-3 flex items-center justify-between px-1 font-semibold">
                {col.title} <span className="rounded-full surface px-2 text-sm">{list.length}</span>
              </h2>
              <div className="space-y-3">
                {list.length === 0 ? (
                  <p className="px-1 py-6 text-center text-sm text-muted">Keine Bestellungen</p>
                ) : null}
                {list.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    now={now}
                    timezone={timezone}
                    pending={pending}
                    onMove={move}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="rounded-xl border border-default surface">
        <button
          type="button"
          onClick={() => setShowDone((s) => !s)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        >
          Erledigt & storniert (heute und gestern){" "}
          <span className="text-muted">
            {done.length} · {showDone ? "ausblenden" : "anzeigen"}
          </span>
        </button>
        {showDone ? (
          <ul className="divide-y divide-[var(--border)] border-t border-default text-sm">
            {done.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <span className="font-semibold">Nr. {o.orderNumber}</span>
                <span>{o.customerName}</span>
                <span className="text-muted">
                  {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                </span>
                <span className="ml-auto tabular-nums">{formatChf(o.totalCents)}</span>
                <Badge tone={o.status === "cancelled" ? "red" : "green"}>
                  {o.status === "cancelled" ? "Storniert" : "Abgeholt"}
                </Badge>
                {o.status === "completed" ? (
                  <Button size="sm" variant="ghost" onClick={() => move(o, "ready")}>
                    Zurück
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function formatMinutes(m: number) {
  if (m < 60) return `${m} Min.`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} Std. ${rest} Min.` : `${h} Std.`;
}

function dueTime(o: BoardOrder) {
  return new Date(o.estimatedReadyAt ?? o.createdAt).getTime();
}

function OrderCard({
  order: o,
  now,
  timezone,
  pending,
  onMove,
}: {
  order: BoardOrder;
  now: number;
  timezone: string;
  pending: boolean;
  onMove: (o: BoardOrder, s: BoardOrder["status"], reason?: string) => void;
}) {
  const due = o.estimatedReadyAt ? new Date(o.estimatedReadyAt) : null;
  const minutes = due ? Math.round((due.getTime() - now) / 60_000) : null;
  const time = due
    ? new Intl.DateTimeFormat("de-CH", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      }).format(due)
    : "–";
  const late = minutes !== null && minutes < 0 && o.status !== "ready";
  const placed = new Intl.DateTimeFormat("de-CH", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(o.createdAt));
  return (
    <article
      className={cn(
        "rounded-xl border border-default surface p-4 shadow-sm",
        o.status === "new" && "ring-2 ring-brand-400/60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-bold tabular-nums">Nr. {o.orderNumber}</div>
          <div className="text-sm font-medium">{o.customerName}</div>
        </div>
        <div className="text-right">
          <div className={cn("text-xl font-semibold tabular-nums", late ? "text-red-600" : "")}>
            {time}
          </div>
          <div className={cn("text-xs", late ? "text-red-600" : "text-muted")}>
            {minutes === null
              ? ""
              : minutes >= 0
                ? `in ${formatMinutes(minutes)}`
                : `${formatMinutes(-minutes)} überfällig`}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        <Badge tone={o.fulfillment === "delivery" ? "blue" : "neutral"}>
          {o.fulfillment === "delivery" ? (
            <Bike className="size-3" />
          ) : (
            <ShoppingBag className="size-3" />
          )}
          {o.fulfillment === "delivery" ? "Lieferung" : "Abholung"}
        </Badge>
        {o.requestedFor ? <Badge tone="yellow">Wunschzeit</Badge> : null}
        {o.paymentMethod ? (
          <Badge>{PAYMENT_LABELS_DE[o.paymentMethod as PaymentMethod] ?? o.paymentMethod}</Badge>
        ) : null}
        {o.isTest ? <Badge tone="purple">Test</Badge> : null}
        <span className="text-muted">bestellt {placed}</span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {o.items.map((i) => (
          <li key={i.id} className="text-[15px] leading-snug">
            <span className="font-semibold">{i.quantity}×</span> {i.name}
            {i.options.length ? (
              <span className="text-muted"> · {i.options.join(", ")}</span>
            ) : null}
            {i.notes ? (
              <div className="ml-6 text-sm font-medium text-amber-700 dark:text-amber-400">
                → {i.notes}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {o.notes ? (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {o.notes}
        </p>
      ) : null}
      {o.deliveryAddress ? (
        <p className="mt-2 text-sm">
          {o.deliveryAddress.street},{" "}
          {[o.deliveryAddress.postalCode, o.deliveryAddress.city].filter(Boolean).join(" ")}
          {o.deliveryAddress.notes ? ` (${o.deliveryAddress.notes})` : ""}
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-between text-sm">
        {o.customerPhone ? (
          <a
            href={`tel:${o.customerPhone}`}
            className="flex items-center gap-1 text-muted hover:underline"
          >
            <Phone className="size-3.5" /> {formatSwissNumber(o.customerPhone)}
          </a>
        ) : (
          <span />
        )}
        <span className="font-semibold tabular-nums">{formatChf(o.totalCents)}</span>
      </div>
      <div className="mt-3 flex gap-2">
        {o.status === "new" ? (
          <Button
            className="flex-1"
            size="lg"
            disabled={pending}
            onClick={() => onMove(o, "accepted")}
          >
            Annehmen
          </Button>
        ) : null}
        {o.status === "accepted" ? (
          <Button
            className="flex-1"
            size="lg"
            disabled={pending}
            onClick={() => onMove(o, "ready")}
          >
            Bereit
          </Button>
        ) : null}
        {o.status === "ready" ? (
          <Button
            className="flex-1"
            size="lg"
            disabled={pending}
            onClick={() => onMove(o, "completed")}
          >
            {o.fulfillment === "delivery" ? "Geliefert" : "Abgeholt"}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="lg"
          disabled={pending}
          onClick={() => {
            const reason = prompt("Grund für die Stornierung?");
            if (reason !== null) onMove(o, "cancelled", reason);
          }}
        >
          Storno
        </Button>
      </div>
    </article>
  );
}
