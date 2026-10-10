/**
 * Opening hours in restaurant-local time, including ranges past midnight ("18:00–02:00"),
 * date-specific exceptions (holidays, vacation) and DST-safe conversion to absolute instants.
 */

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type TimeRange = { open: string; close: string };
export type WeeklyHours = Partial<Record<Weekday, TimeRange[]>>;
export type HoursException = { date: string; ranges: TimeRange[]; note?: string };

export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const WEEKDAY_LABELS_DE: Record<Weekday, string> = {
  mon: "Montag",
  tue: "Dienstag",
  wed: "Mittwoch",
  thu: "Donnerstag",
  fri: "Freitag",
  sat: "Samstag",
  sun: "Sonntag",
};
const WEEKDAY_SHORT_DE: Record<Weekday, string> = {
  mon: "Mo",
  tue: "Di",
  wed: "Mi",
  thu: "Do",
  fri: "Fr",
  sat: "Sa",
  sun: "So",
};

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: Weekday;
  /** YYYY-MM-DD */
  date: string;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAY_FROM_EN: Record<string, Weekday> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

/** Wall-clock parts of an instant in a time zone. */
export function getLocalParts(at: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(at).map((p) => [p.type, p.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: WEEKDAY_FROM_EN[parts.weekday as string] ?? "mon",
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/** Offset (ms) of the time zone relative to UTC at a given instant. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Converts a local wall-clock time to an absolute instant (DST aware). */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let offset = tzOffsetMs(new Date(guess), timeZone);
  let result = guess - offset;
  const offset2 = tzOffsetMs(new Date(result), timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    result = guess - offset;
  }
  return new Date(result);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const idx = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(idx + 6) % 7]!;
}

export function parseTime(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

export function isValidRange(range: TimeRange): boolean {
  const o = parseTime(range.open);
  const c = parseTime(range.close);
  return o !== null && c !== null && o !== c;
}

/** Ranges that apply to a local date (exception overrides the weekly schedule). */
export function rangesForDate(date: string, hours: WeeklyHours, exceptions: HoursException[] = []): TimeRange[] {
  const exception = exceptions.find((e) => e.date === date);
  if (exception) return exception.ranges.filter(isValidRange);
  return (hours[weekdayOf(date)] ?? []).filter(isValidRange);
}

export type Interval = { start: Date; end: Date };

/**
 * Absolute open intervals that intersect [from, from + days). Ranges past midnight are
 * attributed to the day on which they start.
 */
export function openIntervals(
  from: Date,
  hours: WeeklyHours,
  exceptions: HoursException[],
  timeZone: string,
  days = 2,
): Interval[] {
  const startDate = getLocalParts(from, timeZone).date;
  const out: Interval[] = [];
  for (let i = -1; i < days; i++) {
    const date = addDays(startDate, i);
    for (const r of rangesForDate(date, hours, exceptions)) {
      const openMin = parseTime(r.open)!;
      const closeMin = parseTime(r.close)!;
      const start = zonedTimeToUtc(date, r.open, timeZone);
      const endDate = closeMin <= openMin ? addDays(date, 1) : date;
      const closeStr = r.close === "24:00" ? "00:00" : r.close;
      const end = zonedTimeToUtc(r.close === "24:00" ? addDays(date, 1) : endDate, closeStr, timeZone);
      if (end.getTime() > from.getTime() - 24 * 3600_000) out.push({ start, end });
    }
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  // Merge touching/overlapping intervals
  const merged: Interval[] = [];
  for (const iv of out) {
    const last = merged[merged.length - 1];
    if (last && iv.start.getTime() <= last.end.getTime()) {
      if (iv.end > last.end) last.end = iv.end;
    } else merged.push({ ...iv });
  }
  return merged;
}

export function hasAnyHours(hours: WeeklyHours): boolean {
  return WEEKDAYS.some((d) => (hours[d] ?? []).some(isValidRange));
}

export type OpenState = {
  isOpen: boolean;
  /** Current interval when open. */
  current?: Interval;
  /** Next opening when closed. */
  next?: Interval;
};

export function getOpenState(
  at: Date,
  hours: WeeklyHours,
  exceptions: HoursException[],
  timeZone: string,
): OpenState {
  // No hours configured = always open (useful during onboarding).
  if (!hasAnyHours(hours) && !exceptions.length) {
    return { isOpen: true };
  }
  const intervals = openIntervals(at, hours, exceptions, timeZone, 8);
  const t = at.getTime();
  const current = intervals.find((iv) => iv.start.getTime() <= t && t < iv.end.getTime());
  if (current) return { isOpen: true, current };
  const next = intervals.find((iv) => iv.start.getTime() > t);
  return { isOpen: false, next };
}

/** Whether the instant falls inside an opening interval. */
export function isWithinOpeningHours(
  at: Date,
  hours: WeeklyHours,
  exceptions: HoursException[],
  timeZone: string,
): boolean {
  return getOpenState(at, hours, exceptions, timeZone).isOpen;
}

/** "18:30" in restaurant-local time. */
export function formatLocalTime(at: Date, timeZone: string): string {
  const p = getLocalParts(at, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "Samstag, 10.10.2026, 18:30" */
export function formatLocalDateTime(at: Date, timeZone: string): string {
  const p = getLocalParts(at, timeZone);
  return `${WEEKDAY_LABELS_DE[p.weekday]}, ${String(p.day).padStart(2, "0")}.${String(p.month).padStart(2, "0")}.${p.year}, ${formatLocalTime(at, timeZone)}`;
}

/** Rounds up to the next multiple of `step` minutes. */
export function roundUpMinutes(at: Date, step = 5): Date {
  const ms = step * 60_000;
  return new Date(Math.ceil(at.getTime() / ms) * ms);
}

/** Human readable weekly schedule for prompts, e.g. "Mo–Fr 11:00–14:00, 17:00–22:00; Sa 17:00–23:00; So geschlossen". */
export function describeWeeklyHours(hours: WeeklyHours): string {
  if (!hasAnyHours(hours)) return "keine Öffnungszeiten hinterlegt";
  const label = (d: Weekday) => {
    const ranges = (hours[d] ?? []).filter(isValidRange);
    return ranges.length ? ranges.map((r) => `${r.open}–${r.close}`).join(", ") : "geschlossen";
  };
  const groups: { from: Weekday; to: Weekday; text: string }[] = [];
  for (const d of WEEKDAYS) {
    const text = label(d);
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.to = d;
    else groups.push({ from: d, to: d, text });
  }
  return groups
    .map((g) =>
      g.from === g.to
        ? `${WEEKDAY_SHORT_DE[g.from]} ${g.text}`
        : `${WEEKDAY_SHORT_DE[g.from]}–${WEEKDAY_SHORT_DE[g.to]} ${g.text}`,
    )
    .join("; ");
}

/**
 * Validates a requested pickup/delivery time ("HH:MM", restaurant-local, today or the next opening day)
 * and returns the absolute instant.
 */
export function resolveRequestedTime(
  value: string,
  now: Date,
  timeZone: string,
): Date | null {
  const minutes = parseTime(value);
  if (minutes === null) return null;
  const today = getLocalParts(now, timeZone).date;
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  let candidate = zonedTimeToUtc(today, `${hh}:${mm}`, timeZone);
  // Times shortly after midnight said late in the evening refer to the next day.
  if (candidate.getTime() < now.getTime() - 30 * 60_000) {
    candidate = zonedTimeToUtc(addDays(today, 1), `${hh}:${mm}`, timeZone);
  }
  return candidate;
}
