import { describe, expect, test } from "bun:test";
import { skillsRouter } from "./skills";

describe("skillsRouter", () => {
  test("exposes Global Skills catalog and project lifecycle procedures", () => {
    const procedures = skillsRouter._def.procedures as Record<string, unknown>;

    expect(procedures.list).toBeDefined();
    expect(procedures.addToProject).toBeDefined();
    expect(procedures.removeFromProject).toBeDefined();
    expect(procedures.setEnabled).toBeUndefined();
  });
});
