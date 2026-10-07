import { describe, expect, it } from "vitest";
import { withoutEmDashes } from "../src/discord/brain.js";

describe("withoutEmDashes", () => {
  it("turns em dashes into commas", () => {
    expect(withoutEmDashes("Howdy — partner")).toBe("Howdy, partner");
    expect(withoutEmDashes("corny dogs—the best")).toBe("corny dogs, the best");
  });

  it("doesn't leave doubled punctuation behind", () => {
    expect(withoutEmDashes("Well, I never—!")).toBe("Well, I never!");
  });

  it("leaves hyphens and en dashes alone", () => {
    expect(withoutEmDashes("Dallas–Fort Worth, 55-foot")).toBe("Dallas–Fort Worth, 55-foot");
  });
});
