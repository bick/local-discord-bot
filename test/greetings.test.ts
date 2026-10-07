import { describe, expect, it } from "vitest";
import { GREETINGS, isBareGreeting, pickGreeting, stripMentions } from "../src/discord/greetings.js";

describe("greetings", () => {
  it("has 50 distinct lines", () => {
    expect(GREETINGS).toHaveLength(50);
    expect(new Set(GREETINGS).size).toBe(50);
  });

  it("never repeats the previous line", () => {
    const first = pickGreeting(() => 0);
    expect(pickGreeting(() => 0)).not.toBe(first);
  });

  it("treats plain hellos as greetings and anything else as a question", () => {
    for (const s of ["", "hi", "Hey there neighbor!", "howdy y'all", "good morning big tex", "yo"]) expect(isBareGreeting(s), s).toBe(true);
    for (const s of ["what is your favorite color", "hey what's happening this weekend?", "hi, what should I do saturday", "hey big tex how are you doing", "tell me a joke"]) {
      expect(isBareGreeting(s), s).toBe(false);
    }
  });

  it("strips user and role mentions", () => {
    expect(stripMentions("<@123> what's  your <@&456> favorite color")).toBe("what's your favorite color");
  });
});
