import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseIcal, parseRss } from "../src/sources/calendar.js";
import { chicagoDay } from "../src/lib/time.js";

const feed = { id: "feed1", name: "Test", url: "https://example.org/cal.ics", format: "ical", defaultCity: "Dallas", trustWeight: 80 };
const window = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") };

describe("parseIcal", () => {
  const events = parseIcal(readFileSync("test/fixtures/sample.ics", "utf8"), feed, window);

  it("parses all-day multi-day events as Chicago dates", () => {
    const balloon = events.find((e) => e.title.startsWith("Plano Balloon"))!;
    expect(balloon.allDay).toBe(true);
    expect(chicagoDay(balloon.startsAt)).toBe("2026-10-15");
    expect(balloon.startsAt.toISOString()).toBe("2026-10-15T05:00:00.000Z"); // CDT midnight
    expect(chicagoDay(balloon.endsAt!)).toBe("2026-10-18"); // exclusive end
    expect(balloon.city).toBe("Plano");
    expect(balloon.venueName).toBe("Oak Point Park & Nature Preserve");
    expect(balloon.category).toBe("FESTIVAL");
    expect(balloon.description).toBe("Hot air balloons & fireworks.");
    expect(balloon.url).toBe("https://example.org/balloons");
    expect(balloon.feedTrustWeight).toBe(80);
  });

  it("expands RRULEs only inside the window and honors EXDATE", () => {
    const market = events.filter((e) => e.title === "Farmers Market");
    const days = market.map((e) => chicagoDay(e.startsAt));
    expect(days).toEqual(["2026-10-03", "2026-10-10", "2026-10-24", "2026-10-31"]);
    expect(new Set(market.map((e) => e.sourceId)).size).toBe(4);
    expect(market[0]!.startsAt.toISOString()).toBe("2026-10-03T13:00:00.000Z"); // 8am CDT
    expect(market[0]!.city).toBe("McKinney");
  });

  it("marks STATUS:CANCELLED and skips events outside the window", () => {
    expect(events.find((e) => e.title === "Cancelled Concert")?.cancelled).toBe(true);
    expect(events.find((e) => e.title === "Way in the past")).toBeUndefined();
  });

  it("falls back to the feed's default city and URL", () => {
    const council = events.find((e) => e.title === "City Council Meeting")!;
    expect(council.city).toBe("Dallas");
    expect(council.url).toBe(feed.url);
  });
});

describe("parseRss", () => {
  it("reads CivicPlus and RSS event-module dates, skipping items without event dates", async () => {
    const events = await parseRss(readFileSync("test/fixtures/civicplus.rss", "utf8"), { ...feed, format: "rss" }, window);
    expect(events.map((e) => e.title)).toEqual(["Main Street Fest", "Holiday Lights"]);

    const fest = events[0]!;
    expect(fest.startsAt.toISOString()).toBe("2026-10-16T23:00:00.000Z"); // 6pm CDT
    expect(fest.endsAt!.toISOString()).toBe("2026-10-17T04:00:00.000Z");
    expect(fest.allDay).toBe(false);
    expect(fest.city).toBe("Grapevine");

    const lights = events[1]!;
    expect(lights.allDay).toBe(true);
    expect(chicagoDay(lights.startsAt)).toBe("2026-10-20");
  });
});
