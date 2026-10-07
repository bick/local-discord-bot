import { describe, expect, it } from "vitest";
import { GREETINGS, pickGreeting } from "../src/discord/greetings.js";

describe("greetings", () => {
  it("has 50 distinct lines", () => {
    expect(GREETINGS).toHaveLength(50);
    expect(new Set(GREETINGS).size).toBe(50);
  });

  it("never repeats the previous line", () => {
    const first = pickGreeting(() => 0);
    expect(pickGreeting(() => 0)).not.toBe(first);
  });
});
