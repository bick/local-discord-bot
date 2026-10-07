import { describe, expect, it } from "vitest";
import type { Event } from "@prisma/client";
import { dedupeKey, dedupePrefix, mergeDuplicate, venuesMatch } from "../src/pipeline/dedupe.js";
import { normalizeTitle } from "../src/pipeline/normalize.js";

describe("normalizeTitle", () => {
  it("drops sponsors, punctuation, and articles", () => {
    expect(normalizeTitle("The Plano Balloon Festival presented by Lexus")).toBe("plano balloon festival");
    expect(normalizeTitle("Mavericks vs. Spurs!")).toBe("mavericks vs spurs");
    expect(normalizeTitle("Beyoncé – Tickets")).toBe("beyonce");
    expect(normalizeTitle("Rock & Roll Night")).toBe("rock and roll night");
  });
});

describe("dedupeKey", () => {
  it("uses the Chicago calendar day, not UTC", () => {
    // 9:30pm CDT on Oct 10 is Oct 11 in UTC.
    const key = dedupeKey({ title: "Concert", startsAt: new Date("2026-10-11T02:30:00Z"), venueName: "Dos Equis Pavilion" });
    expect(key).toBe("concert|2026-10-10|dos equis pavilion");
  });

  it("matches the same show from SeatGeek and a venue calendar", () => {
    const sg = dedupeKey({ title: "Dallas Mavericks vs. San Antonio Spurs", startsAt: new Date("2026-11-01T00:30:00Z"), venueName: "American Airlines Center" });
    const cal = dedupeKey({ title: "Dallas Mavericks vs San Antonio Spurs presented by Chime", startsAt: new Date("2026-11-01T01:00:00Z"), venueName: "The American Airlines Center" });
    expect(dedupePrefix(sg)).toBe(dedupePrefix(cal));
    expect(venuesMatch(sg, cal)).toBe(true);
  });

  it("falls back to rounded coordinates when there's no venue", () => {
    expect(dedupeKey({ title: "X", startsAt: new Date("2026-10-10T18:00:00Z"), lat: 32.77671, lng: -96.79702 })).toBe("x|2026-10-10|32.78,-96.80");
  });

  it("treats a venue name contained in the other as the same place", () => {
    expect(venuesMatch("a|d|oak point", "a|d|oak point and nature preserve")).toBe(true);
    expect(venuesMatch("a|d|dickies", "a|d|globe life field")).toBe(false);
    expect(venuesMatch("a|d|", "a|d|globe life field")).toBe(true);
  });
});

describe("mergeDuplicate", () => {
  const common = {
    category: "OTHER" as const, venueName: null, city: null, lat: null, lng: null, endsAt: null, allDay: false,
    imageUrl: null, priceMin: null, popularity: null, feedId: null, description: null, url: "",
  };
  const sg = { ...common, source: "SEATGEEK" as const, title: "Mavs vs Spurs - Tickets", startsAt: new Date("2026-11-01T00:30:00Z"), url: "https://seatgeek.com/x", imageUrl: "https://img/x.jpg", priceMin: 45 as unknown as Event["priceMin"], popularity: 0.8, category: "SPORTS" as const, venueName: "American Airlines Center" };
  const cal = { ...common, source: "CALENDAR" as const, title: "Mavericks vs. Spurs", startsAt: new Date("2026-11-01T01:00:00Z"), url: "https://mavs.com/game", description: "Official", feedId: "f1" };

  it("prefers SeatGeek for price/image/time and the calendar for description/url/title", () => {
    for (const merged of [mergeDuplicate(sg, cal), mergeDuplicate(cal, sg)]) {
      expect(merged.imageUrl).toBe("https://img/x.jpg");
      expect(merged.priceMin).toBe(45);
      expect(merged.startsAt).toEqual(sg.startsAt);
      expect(merged.description).toBe("Official");
      expect(merged.url).toBe("https://mavs.com/game");
      expect(merged.title).toBe("Mavericks vs. Spurs");
      expect(merged.category).toBe("SPORTS");
      expect(merged.feed).toEqual({ connect: { id: "f1" } });
    }
  });
});
