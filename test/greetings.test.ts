import { describe, expect, it } from "vitest";
import { GREETINGS, isGreeting, pickGreeting } from "../src/discord/greetings.js";

describe("greetings", () => {
  it("has 50 distinct lines", () => {
    expect(GREETINGS).toHaveLength(50);
    expect(new Set(GREETINGS).size).toBe(50);
  });

  it("recognizes short hellos, with or without a mention", () => {
    for (const s of ["hi", "Hi!", "hey", "Heyyy", "hello there", "howdy y'all", "<@123> hi", "<@!123> Hey Tex!", "yo", "sup", "good morning", "hiya big tex"]) {
      expect(isGreeting(s), s).toBe(true);
    }
  });

  it("ignores anything that isn't just a hello", () => {
    for (const s of ["", "<@123>", "hi can you find me a concert", "history", "this is a hint", "highway closed", "whatever"]) {
      expect(isGreeting(s), s).toBe(false);
    }
  });

  it("never repeats the previous line", () => {
    const first = pickGreeting(() => 0);
    expect(pickGreeting(() => 0)).not.toBe(first);
  });
});
