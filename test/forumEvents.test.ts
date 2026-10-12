import { describe, expect, it } from "vitest";
import { parseForumTitle } from "../src/discord/forumEvents.js";

// Sunday Oct 11 2026, 10am Chicago
const NOW = new Date("2026-10-11T15:00:00Z");

describe("parseForumTitle", () => {
  it("pulls the name, time, and @ location out of the title", () => {
    const p = parseForumTitle("Rangers game Sat 7pm @ Globe Life Field", NOW);
    expect(p).toEqual({
      name: "Rangers game",
      start: new Date("2026-10-18T00:00:00Z"), // Sat Oct 17, 7pm CDT
      end: new Date("2026-10-18T03:00:00Z"),
      location: "Globe Life Field",
    });
  });

  it("uses a parsed range for the end time", () => {
    const p = parseForumTitle("Trivia night - Oct 15 7-9pm", NOW);
    expect(p?.name).toBe("Trivia night");
    expect(p?.start).toEqual(new Date("2026-10-16T00:00:00Z"));
    expect(p?.end).toEqual(new Date("2026-10-16T02:00:00Z"));
    expect(p?.location).toBeNull();
  });

  it("doesn't read 'night' as tonight", () => {
    expect(parseForumTitle("Game night Friday 8pm", NOW)).toMatchObject({ name: "Game night", start: new Date("2026-10-17T01:00:00Z") });
  });

  it("returns null without a date", () => {
    expect(parseForumTitle("Anyone want to grab tacos?", NOW)).toBeNull();
  });

  it("keeps the full title when the date is all there is", () => {
    expect(parseForumTitle("Friday 8pm", NOW)?.name).toBe("Friday 8pm");
  });
});
