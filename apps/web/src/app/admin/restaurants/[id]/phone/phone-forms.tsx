"use client";

import { formatSwissNumber } from "@justcall/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { connectNumber, disconnectNumber, reconfigureWebhooks } from "@/server/actions/phone";

export function ConnectNumberForm({
  restaurantId,
  publicPhone,
  available,
}: {
  restaurantId: string;
  publicPhone: string | null;
  available: { sid: string; phoneNumber: string; friendlyName: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState(available[0]?.sid ?? "manual");
  const [manual, setManual] = useState("");
  const [forwardedFrom, setForwardedFrom] = useState(publicPhone ?? "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const choice = available.find((n) => n.sid === selected);
    start(async () => {
      const res = await connectNumber(restaurantId, {
        e164: choice?.phoneNumber ?? manual,
        providerSid: choice?.sid ?? null,
        label: choice?.friendlyName ?? null,
        forwardedFrom: forwardedFrom || null,
      });
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.message ?? "Connected");
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label="JustCall number" htmlFor="number">
        <Select id="number" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {available.map((n) => (
            <option key={n.sid} value={n.sid}>
              {formatSwissNumber(n.phoneNumber)}{" "}
              {n.friendlyName !== n.phoneNumber ? `· ${n.friendlyName}` : ""}
            </option>
          ))}
          <option value="manual">Enter manually…</option>
        </Select>
      </Field>
      {selected === "manual" ? (
        <Field label="Number (E.164)" htmlFor="manual">
          <Input
            id="manual"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="+41 44 505 12 34"
            required
          />
        </Field>
      ) : (
        <div />
      )}
      <Field
        label="Forwarded from (restaurant's number)"
        htmlFor="fwd"
        hint="For your records and the forwarding instructions."
      >
        <Input
          id="fwd"
          value={forwardedFrom}
          onChange={(e) => setForwardedFrom(e.target.value)}
          placeholder="044 123 45 67"
        />
      </Field>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Connecting…" : "Connect number"}
        </Button>
      </div>
    </form>
  );
}

export function NumberActions({ numberId, hasSid }: { numberId: string; hasSid: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string } | undefined>) =>
    start(async () => {
      const res = await fn();
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.message ?? "Done");
        router.refresh();
      }
    });
  return (
    <div className="flex gap-1">
      {hasSid ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(() => reconfigureWebhooks(numberId))}
        >
          Re-apply webhooks
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          confirm(
            "Disconnect this number? Calls will no longer reach this restaurant's assistant.",
          ) && run(() => disconnectNumber(numberId))
        }
      >
        Disconnect
      </Button>
    </div>
  );
}
