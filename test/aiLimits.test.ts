import { describe, expect, it } from "vitest";
import { AiLimiter } from "../src/discord/aiLimits.js";

describe("AiLimiter", () => {
  it("caps each user per day", () => {
    const l = new AiLimiter(100, 2, () => new Date("2026-10-07T15:00:00Z"));
    l.record("a");
    l.record("a");
    expect(l.check("a")).toBe("user-limit");
    expect(l.check("b")).toBe("ok");
  });

  it("caps the whole bot per day", () => {
    const l = new AiLimiter(3, 10, () => new Date("2026-10-07T15:00:00Z"));
    for (const u of ["a", "b", "c"]) l.record(u);
    expect(l.check("d")).toBe("daily-limit");
  });

  it("resets at midnight Central, not UTC", () => {
    let now = new Date("2026-10-07T23:30:00Z"); // 6:30pm Central on the 7th
    const l = new AiLimiter(1, 1, () => now);
    l.record("a");
    now = new Date("2026-10-08T03:00:00Z"); // 10pm Central, still the 7th
    expect(l.check("a")).toBe("daily-limit");
    now = new Date("2026-10-08T05:30:00Z"); // 12:30am Central on the 8th
    expect(l.check("a")).toBe("ok");
  });
});
