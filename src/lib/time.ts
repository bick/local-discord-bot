import { differenceInCalendarDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { TIME_ZONE } from "../config.js";

/** YYYY-MM-DD of an instant, in America/Chicago. */
export function chicagoDay(date: Date): string {
  return formatInTimeZone(date, TIME_ZONE, "yyyy-MM-dd");
}

/** The UTC instant of midnight (Chicago) on the given Chicago calendar day. */
export function chicagoMidnight(day: string): Date {
  return fromZonedTime(`${day}T00:00:00`, TIME_ZONE);
}

/** Shift a YYYY-MM-DD calendar day by n days (pure calendar math, DST-safe). */
export function addCalendarDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday .. 6 = Saturday, for a Chicago calendar day. */
function dayOfWeek(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Number of Chicago calendar days an event touches (1 for a single-day event). */
export function spanDays(startsAt: Date, endsAt: Date | null | undefined, allDay: boolean): number {
  if (!endsAt || endsAt <= startsAt) return 1;
  // All-day DTEND is exclusive, so a 3-day festival ends at midnight of day 4.
  const lastInstant = allDay ? new Date(endsAt.getTime() - 1) : endsAt;
  return differenceInCalendarDays(toZonedTime(lastInstant, TIME_ZONE), toZonedTime(startsAt, TIME_ZONE)) + 1;
}

/**
 * Friday 00:00 through Monday 00:00 in Chicago. Mon-Thu returns the coming
 * weekend; Fri-Sun returns the weekend in progress (starting now).
 */
export function weekendWindow(now: Date = new Date()): { from: Date; to: Date } {
  const today = chicagoDay(now);
  const dow = dayOfWeek(today);
  const offsetToFriday = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow;
  const friday = addCalendarDays(today, offsetToFriday);
  const fridayMidnight = chicagoMidnight(friday);
  return {
    from: fridayMidnight > now ? fridayMidnight : now,
    to: chicagoMidnight(addCalendarDays(friday, 3)),
  };
}

export function unix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** 0..23 hour of an instant in Chicago. */
export function chicagoHour(date: Date): number {
  return Number(formatInTimeZone(date, TIME_ZONE, "H"));
}
