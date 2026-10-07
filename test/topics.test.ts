import { describe, expect, it } from "vitest";
import { pickTopic, TOPIC_CATEGORIES, TOPICS } from "../src/discord/topics.js";

describe("topics", () => {
  it("has distinct topics in every category", () => {
    for (const c of TOPIC_CATEGORIES) {
      expect(TOPICS[c].length, c).toBeGreaterThanOrEqual(10);
      expect(new Set(TOPICS[c]).size, c).toBe(TOPICS[c].length);
    }
  });

  it("doesn't repeat within a category until every topic has been used", () => {
    const seen = new Set<string>();
    for (let i = 0; i < TOPICS.hypothetical.length; i++) seen.add(pickTopic("hypothetical").topic);
    expect(seen.size).toBe(TOPICS.hypothetical.length);
  });

  it("picks from the requested category", () => {
    expect(pickTopic("nostalgia").category).toBe("nostalgia");
    expect(TOPICS.nostalgia).toContain(pickTopic("nostalgia").topic);
  });
});
