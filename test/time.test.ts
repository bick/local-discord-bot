import { describe, expect, it } from "vitest";
import { addCalendarDays, chicagoDay, spanDays, weekendWindow } from "../src/lib/time.js";

describe("weekendWindow", () => {
  it("on a Thursday returns the coming Fri 00:00 to Mon 00:00 Chicago", () => {
    const { from, to } = weekendWindow(new Date("2026-10-08T22:00:00Z")); // Thu 5pm CDT
    expect(from.toISOString()).toBe("2026-10-09T05:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });

  it("on Saturday starts now and ends Monday", () => {
    const now = new Date("2026-10-10T18:00:00Z");
    const { from, to } = weekendWindow(now);
    expect(from).toEqual(now);
    expect(to.toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });

  it("handles the DST change weekend (Nov 1 2026)", () => {
    const { from, to } = weekendWindow(new Date("2026-10-29T12:00:00Z"));
    expect(from.toISOString()).toBe("2026-10-30T05:00:00.000Z"); // CDT
    expect(to.toISOString()).toBe("2026-11-02T06:00:00.000Z"); // CST
  });
});

describe("spanDays", () => {
  it("treats all-day DTEND as exclusive", () => {
    expect(spanDays(new Date("2026-10-15T05:00:00Z"), new Date("2026-10-18T05:00:00Z"), true)).toBe(3);
    expect(spanDays(new Date("2026-10-15T05:00:00Z"), new Date("2026-10-16T05:00:00Z"), true)).toBe(1);
  });
  it("counts days touched by a timed event in Chicago", () => {
    expect(spanDays(new Date("2026-10-15T23:00:00Z"), new Date("2026-10-16T04:00:00Z"), false)).toBe(1);
    expect(spanDays(new Date("2026-10-15T23:00:00Z"), null, false)).toBe(1);
  });
});

describe("calendar days", () => {
  it("formats in Chicago and adds days across month ends", () => {
    expect(chicagoDay(new Date("2026-10-11T03:00:00Z"))).toBe("2026-10-10");
    expect(addCalendarDays("2026-10-30", 3)).toBe("2026-11-02");
  });
});
