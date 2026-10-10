import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const TZ = "Europe/Zurich";

export function formatDateTime(value: Date | string | null | undefined, tz = TZ): string {
  if (!value) return "–";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("de-CH", {
    timeZone: tz,
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

export function formatTime(value: Date | string | null | undefined, tz = TZ): string {
  if (!value) return "–";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("de-CH", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatDate(value: Date | string | null | undefined, tz = TZ): string {
  if (!value) return "–";
  const d =
    typeof value === "string"
      ? new Date(`${value.length === 10 ? `${value}T12:00:00Z` : value}`)
      : value;
  return new Intl.DateTimeFormat("de-CH", { timeZone: tz, dateStyle: "medium" }).format(d);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds && seconds !== 0) return "–";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}:${String(s).padStart(2, "0")} min` : `${s} s`;
}

export function relativeTime(value: Date | string | null | undefined): string {
  if (!value) return "–";
  const d = typeof value === "string" ? new Date(value) : value;
  const diff = Math.round((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}
