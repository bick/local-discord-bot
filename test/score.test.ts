import { describe, expect, it } from "vitest";
import { bigScore, venueCapacity, type ScoreInput } from "../src/pipeline/score.js";

const base: ScoreInput = {
  source: "CALENDAR",
  title: "Something",
  category: "OTHER",
  startsAt: new Date("2026-10-10T19:00:00Z"),
};

describe("venueCapacity", () => {
  it("recognizes major DFW venues", () => {
    expect(venueCapacity("AT&T Stadium")).toBe(80_000);
    expect(venueCapacity("American Airlines Center")).toBe(20_000);
    expect(venueCapacity("Dickies Arena")).toBe(14_000);
    expect(venueCapacity("Joe's Bar")).toBeNull();
    expect(venueCapacity(null)).toBeNull();
  });
});

describe("bigScore", () => {
  it("rates a popular Cowboys game at AT&T Stadium high enough for a Scheduled Event", () => {
    const s = bigScore({ ...base, source: "SEATGEEK", title: "Dallas Cowboys vs. Philadelphia Eagles", category: "SPORTS", venueName: "AT&T Stadium", popularity: 0.85 });
    expect(s).toBeGreaterThanOrEqual(75);
  });

  it("keeps a small-club SeatGeek show under the default threshold", () => {
    const s = bigScore({ ...base, source: "SEATGEEK", title: "Local Band", category: "CONCERT", venueName: "Three Links", popularity: 0.2 });
    expect(s).toBeLessThan(60);
  });

  it("lets a high-trust festival feed carry a multi-day festival", () => {
    const s = bigScore({
      ...base,
      title: "Plano Balloon Festival",
      category: "FESTIVAL",
      venueName: "Oak Point Park",
      allDay: true,
      startsAt: new Date("2026-09-17T05:00:00Z"),
      endsAt: new Date("2026-09-21T05:00:00Z"),
      feedTrustWeight: 90,
    });
    expect(s).toBe(100);
  });

  it("buries council meetings and story time from a low-trust city feed", () => {
    expect(bigScore({ ...base, title: "City Council Meeting", feedTrustWeight: 40 })).toBeLessThan(10);
    expect(bigScore({ ...base, title: "Toddler Story Time", category: "FAMILY", feedTrustWeight: 40 })).toBeLessThan(20);
  });

  it("boosts multi-day spans and big keywords", () => {
    const one = bigScore({ ...base, feedTrustWeight: 50 });
    const multi = bigScore({ ...base, feedTrustWeight: 50, endsAt: new Date("2026-10-13T19:00:00Z") });
    const keyword = bigScore({ ...base, feedTrustWeight: 50, title: "Fireworks over the lake" });
    expect(multi).toBeGreaterThan(one);
    expect(keyword).toBeGreaterThan(one);
  });

  it("is clamped to 0..100", () => {
    expect(bigScore({ ...base, title: "Board meeting" })).toBe(0);
    expect(bigScore({ ...base, source: "SEATGEEK", title: "Rodeo Championship Finals", category: "FESTIVAL", venueName: "AT&T Stadium", popularity: 1, endsAt: new Date("2026-10-20T00:00:00Z"), feedTrustWeight: 100 })).toBe(100);
  });
});
