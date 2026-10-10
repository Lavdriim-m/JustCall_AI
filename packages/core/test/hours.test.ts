import { describe, expect, it } from "vitest";
import { demoRestaurant } from "../src/fixtures/demo";
import {
  describeWeeklyHours,
  formatLocalTime,
  getLocalParts,
  getOpenState,
  resolveRequestedTime,
  zonedTimeToUtc,
} from "../src/hours";

const tz = "Europe/Zurich";
const { openingHours, hoursExceptions } = demoRestaurant;

describe("time zone helpers", () => {
  it("converts local time to UTC across DST", () => {
    expect(zonedTimeToUtc("2026-07-01", "12:00", tz).toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(zonedTimeToUtc("2026-01-15", "12:00", tz).toISOString()).toBe("2026-01-15T11:00:00.000Z");
  });
  it("reads local parts", () => {
    const p = getLocalParts(new Date("2026-10-10T16:42:00Z"), tz);
    expect(p).toMatchObject({ date: "2026-10-10", hour: 18, minute: 42, weekday: "sat" });
  });
});

describe("opening hours", () => {
  it("is open during a range and closed between ranges", () => {
    // Wednesday 2026-10-07
    expect(getOpenState(zonedTimeToUtc("2026-10-07", "12:00", tz), openingHours, hoursExceptions, tz).isOpen).toBe(true);
    const between = getOpenState(zonedTimeToUtc("2026-10-07", "15:30", tz), openingHours, hoursExceptions, tz);
    expect(between.isOpen).toBe(false);
    expect(formatLocalTime(between.next!.start, tz)).toBe("17:00");
  });
  it("handles ranges past midnight", () => {
    // Saturday 01:30 belongs to Friday's 17:00–02:00 range
    expect(getOpenState(zonedTimeToUtc("2026-10-10", "01:30", tz), openingHours, hoursExceptions, tz).isOpen).toBe(true);
    expect(getOpenState(zonedTimeToUtc("2026-10-10", "02:30", tz), openingHours, hoursExceptions, tz).isOpen).toBe(false);
  });
  it("applies exceptions (holidays)", () => {
    // 2026-12-25 is a Friday but closed
    expect(getOpenState(zonedTimeToUtc("2026-12-25", "19:00", tz), openingHours, hoursExceptions, tz).isOpen).toBe(false);
  });
  it("treats an empty schedule as always open", () => {
    expect(getOpenState(new Date(), {}, [], tz).isOpen).toBe(true);
  });
  it("describes the week compactly", () => {
    expect(describeWeeklyHours(openingHours)).toBe(
      "Mo–Do 11:00–14:00, 17:00–22:30; Fr 11:00–14:00, 17:00–02:00; Sa 17:00–02:00; So 17:00–22:00",
    );
  });
  it("resolves requested times to today or after midnight", () => {
    const now = zonedTimeToUtc("2026-10-10", "23:00", tz);
    expect(resolveRequestedTime("23:30", now, tz)!.toISOString()).toBe(zonedTimeToUtc("2026-10-10", "23:30", tz).toISOString());
    expect(resolveRequestedTime("00:30", now, tz)!.toISOString()).toBe(zonedTimeToUtc("2026-10-11", "00:30", tz).toISOString());
    expect(resolveRequestedTime("abc", now, tz)).toBeNull();
  });
});
