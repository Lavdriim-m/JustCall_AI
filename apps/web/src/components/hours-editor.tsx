"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { updateOpeningHours } from "@/server/actions/restaurants";

type Range = { open: string; close: string };
type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const DAYS: { key: Weekday; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

export function HoursEditor({
  restaurantId,
  weekly: initialWeekly,
  exceptions: initialExceptions,
}: {
  restaurantId: string;
  weekly: Partial<Record<Weekday, Range[]>>;
  exceptions: { date: string; ranges: Range[]; note?: string }[];
}) {
  const [weekly, setWeekly] = useState<Record<Weekday, Range[]>>(
    () =>
      Object.fromEntries(DAYS.map((d) => [d.key, initialWeekly[d.key] ?? []])) as Record<
        Weekday,
        Range[]
      >,
  );
  const [exceptions, setExceptions] = useState(initialExceptions);
  const [pending, start] = useTransition();

  const updateRange = (day: Weekday, i: number, field: keyof Range, value: string) =>
    setWeekly((w) => ({
      ...w,
      [day]: w[day].map((r, j) => (j === i ? { ...r, [field]: value } : r)),
    }));

  const copyMonday = () =>
    setWeekly((w) => ({
      ...w,
      tue: [...w.mon],
      wed: [...w.mon],
      thu: [...w.mon],
      fri: [...w.mon],
    }));

  const save = () =>
    start(async () => {
      const res = await updateOpeningHours(restaurantId, { weekly, exceptions });
      if (res?.error) toast.error(res.error);
      else toast.success("Opening hours saved");
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Weekly opening hours"
          description="Times are restaurant-local (Europe/Zurich). Ranges past midnight are allowed, e.g. 17:00–02:00. No hours at all = always open."
          actions={
            <Button variant="secondary" size="sm" onClick={copyMonday} type="button">
              Copy Monday to Tue–Fri
            </Button>
          }
        />
        <CardBody className="divide-y divide-[var(--border)] p-0">
          {DAYS.map((d) => (
            <div key={d.key} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="w-28 text-sm font-medium">{d.label}</div>
              <div className="flex flex-1 flex-wrap items-center gap-2">
                {weekly[d.key].length === 0 ? (
                  <span className="text-sm text-muted">Closed</span>
                ) : null}
                {weekly[d.key].map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 rounded-lg border border-default p-1"
                  >
                    <Input
                      type="time"
                      value={r.open}
                      onChange={(e) => updateRange(d.key, i, "open", e.target.value)}
                      className="h-8 w-[132px]"
                      aria-label="Opens"
                    />
                    <span className="text-muted">–</span>
                    <Input
                      type="time"
                      value={r.close}
                      onChange={(e) => updateRange(d.key, i, "close", e.target.value)}
                      className="h-8 w-[132px]"
                      aria-label="Closes"
                    />
                    <button
                      type="button"
                      className="rounded p-1 text-muted hover:text-red-600"
                      onClick={() =>
                        setWeekly((w) => ({ ...w, [d.key]: w[d.key].filter((_, j) => j !== i) }))
                      }
                      aria-label="Remove range"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
                {weekly[d.key].length < 4 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setWeekly((w) => ({
                        ...w,
                        [d.key]: [
                          ...w[d.key],
                          w[d.key].length
                            ? { open: "17:00", close: "22:00" }
                            : { open: "11:00", close: "14:00" },
                        ],
                      }))
                    }
                  >
                    <Plus /> Add range
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Holidays & exceptions"
          description="Override specific dates. Without time ranges the restaurant is closed that day."
          actions={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setExceptions((e) => [
                  ...e,
                  { date: new Date().toISOString().slice(0, 10), ranges: [], note: "" },
                ])
              }
            >
              <Plus /> Add date
            </Button>
          }
        />
        <CardBody className="space-y-3">
          {exceptions.length === 0 ? <p className="text-sm text-muted">No exceptions.</p> : null}
          {exceptions.map((ex, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-default p-3"
            >
              <Input
                type="date"
                value={ex.date}
                onChange={(e) =>
                  setExceptions((all) =>
                    all.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)),
                  )
                }
                className="h-8 w-[160px]"
              />
              <Input
                placeholder="Note, e.g. Christmas"
                value={ex.note ?? ""}
                onChange={(e) =>
                  setExceptions((all) =>
                    all.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)),
                  )
                }
                className="h-8 w-[200px]"
              />
              {ex.ranges.map((r, k) => (
                <div key={k} className="flex items-center gap-1">
                  <Input
                    type="time"
                    value={r.open}
                    className="h-8 w-[132px]"
                    onChange={(e) =>
                      setExceptions((all) =>
                        all.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                ranges: x.ranges.map((rr, kk) =>
                                  kk === k ? { ...rr, open: e.target.value } : rr,
                                ),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                  –
                  <Input
                    type="time"
                    value={r.close}
                    className="h-8 w-[132px]"
                    onChange={(e) =>
                      setExceptions((all) =>
                        all.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                ranges: x.ranges.map((rr, kk) =>
                                  kk === k ? { ...rr, close: e.target.value } : rr,
                                ),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </div>
              ))}
              <span className="text-sm text-muted">{ex.ranges.length ? "" : "Closed all day"}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setExceptions((all) =>
                    all.map((x, j) =>
                      j === i
                        ? { ...x, ranges: [...x.ranges, { open: "17:00", close: "22:00" }] }
                        : x,
                    ),
                  )
                }
              >
                <Plus /> Hours
              </Button>
              <button
                type="button"
                className="ml-auto rounded p-1 text-muted hover:text-red-600"
                onClick={() => setExceptions((all) => all.filter((_, j) => j !== i))}
                aria-label="Remove"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </CardBody>
      </Card>
      <Button onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save opening hours"}
      </Button>
    </div>
  );
}
