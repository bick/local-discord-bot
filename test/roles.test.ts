import { describe, expect, it } from "vitest";
import { COLOR_ROLES, rolePanel } from "../src/discord/roles.js";

describe("role panel", () => {
  it("fits Discord's select menu limits with unique color names", () => {
    expect(COLOR_ROLES.length + 1).toBeLessThanOrEqual(25); // +1 for "No color"
    expect(new Set(COLOR_ROLES.map((c) => c.name)).size).toBe(COLOR_ROLES.length);
    expect(COLOR_ROLES.every((c) => c.color > 0 && c.color <= 0xffffff)).toBe(true);
  });

  it("builds a color menu and a politics button", () => {
    const json = rolePanel().components.map((row) => row.toJSON());
    const select = json[0]!.components[0] as { custom_id: string; options: unknown[] };
    const button = json[1]!.components[0] as { custom_id: string };
    expect(select.custom_id).toBe("roles:color");
    expect(select.options).toHaveLength(COLOR_ROLES.length + 1);
    expect(button.custom_id).toBe("roles:politics");
  });
});
