import { describe, expect, it } from "vitest";
import { parseRsvpCustomId, rsvpCustomId, whenText, threadName } from "../src/discord/embeds.js";
import { parseCategories } from "../src/discord/commands/setup.js";
import { normalizeSeatgeek, seatgeekCategory } from "../src/sources/seatgeek.js";

describe("rsvp custom ids", () => {
  it("round-trips", () => {
    expect(parseRsvpCustomId(rsvpCustomId("GOING", "abc123"))).toEqual({ status: "GOING", eventId: "abc123" });
    expect(parseRsvpCustomId("something-else")).toBeNull();
  });
});

describe("whenText", () => {
  it("renders single all-day events as a date anchored at noon", () => {
    expect(whenText({ startsAt: new Date("2026-10-24T05:00:00Z"), endsAt: new Date("2026-10-25T05:00:00Z"), allDay: true })).toBe(
      `<t:${Date.parse("2026-10-24T17:00:00Z") / 1000}:D>`,
    );
  });
  it("renders multi-day all-day events as an inclusive range", () => {
    const text = whenText({ startsAt: new Date("2026-09-25T05:00:00Z"), endsAt: new Date("2026-10-19T05:00:00Z"), allDay: true });
    expect(text).toBe(`<t:${Date.parse("2026-09-25T17:00:00Z") / 1000}:D> – <t:${Date.parse("2026-10-18T17:00:00Z") / 1000}:D>`);
  });
  it("renders timed events with a relative stamp", () => {
    const t = Date.parse("2026-10-10T19:30:00Z") / 1000;
    expect(whenText({ startsAt: new Date(t * 1000), endsAt: null, allDay: false })).toBe(`<t:${t}:F> (<t:${t}:R>)`);
  });
});

describe("threadName", () => {
  it("fits Discord's 100 char limit", () => {
    expect(threadName("x".repeat(200)).length).toBeLessThanOrEqual(100);
  });
});

describe("parseCategories", () => {
  it("accepts all, comma lists, and aliases", () => {
    expect(parseCategories("all")).toEqual([]);
    expect(parseCategories("festival, music,sports")).toEqual(["FESTIVAL", "CONCERT", "SPORTS"]);
    expect(parseCategories("nope")).toBe("invalid");
  });
});

describe("SeatGeek normalization", () => {
  it("maps categories from type and taxonomies", () => {
    expect(seatgeekCategory({ type: "nba", taxonomies: [{ name: "sports" }] })).toBe("SPORTS");
    expect(seatgeekCategory({ type: "concert", taxonomies: [] })).toBe("CONCERT");
    expect(seatgeekCategory({ type: "music_festival", taxonomies: [{ name: "concert" }] })).toBe("FESTIVAL");
    expect(seatgeekCategory({ type: "comedy", taxonomies: null })).toBe("OTHER");
  });

  it("treats zone-less datetime_utc as UTC and picks the biggest image", () => {
    const e = normalizeSeatgeek({
      id: 42,
      title: "Dallas Stars vs. Colorado Avalanche",
      datetime_utc: "2026-10-20T00:30:00",
      url: "https://seatgeek.com/e/42",
      score: 0.7,
      popularity: 0.75,
      type: "nhl",
      venue: { name: "American Airlines Center", city: "Dallas", location: { lat: 32.79, lon: -96.81 } },
      performers: [{ image: "small.jpg", images: { huge: "https://img/huge.jpg" } }],
      stats: { lowest_price: 38 },
    });
    expect(e.startsAt.toISOString()).toBe("2026-10-20T00:30:00.000Z");
    expect(e.imageUrl).toBe("https://img/huge.jpg");
    expect(e.popularity).toBe(0.75);
    expect(e.priceMin).toBe(38);
    expect(e.category).toBe("SPORTS");
    expect(e.sourceId).toBe("42");
  });
});
