import { describe, expect, test } from "bun:test";
import { agentsRouter } from "./agents";

describe("agentsRouter", () => {
  test("keeps extracted query procedures on the flat agents interface", () => {
    const procedures = agentsRouter._def.procedures as Record<string, unknown>;

    expect(procedures.list).toBeDefined();
    expect(procedures.query).toBeUndefined();
    expect(procedures.agentsQuery).toBeUndefined();
  });

  test("keeps extracted mutation procedures on the flat agents interface", () => {
    const procedures = agentsRouter._def.procedures as Record<string, unknown>;

    expect(procedures.create).toBeDefined();
    expect(procedures.update).toBeDefined();
    expect(procedures.delete).toBeDefined();
    expect(procedures.mutation).toBeUndefined();
    expect(procedures.agentsMutation).toBeUndefined();
  });

  test("keeps extracted active-state procedures on the flat agents interface", () => {
    const procedures = agentsRouter._def.procedures as Record<string, unknown>;

    expect(procedures.setActive).toBeDefined();
    expect(procedures.active).toBeUndefined();
    expect(procedures.agentsActive).toBeUndefined();
  });
});
