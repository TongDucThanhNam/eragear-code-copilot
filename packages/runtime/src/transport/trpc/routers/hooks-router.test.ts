import { describe, expect, test } from "bun:test";
import { hooksRouter } from "./hooks";

describe("hooksRouter", () => {
  test("keeps extracted hook base procedures on the flat hooks interface", () => {
    const procedures = hooksRouter._def.procedures as Record<string, unknown>;

    expect(procedures.list).toBeDefined();
    expect(procedures.upsert).toBeDefined();
    expect(procedures.toggle).toBeDefined();
    expect(procedures.updateLifecyclePolicy).toBeDefined();
    expect(procedures.updateSchedulingPolicy).toBeDefined();
    expect(procedures.base).toBeUndefined();
    expect(procedures.hookBase).toBeUndefined();
  });

  test("keeps extracted hook run and audit procedures on the flat hooks interface", () => {
    const procedures = hooksRouter._def.procedures as Record<string, unknown>;

    expect(procedures.trust).toBeDefined();
    expect(procedures.approveRun).toBeDefined();
    expect(procedures.run).toBeDefined();
    expect(procedures.reviewRun).toBeDefined();
    expect(procedures.exportRuns).toBeDefined();
    expect(procedures.hookRun).toBeUndefined();
  });

  test("keeps extracted hook batch procedures on the flat hooks interface", () => {
    const procedures = hooksRouter._def.procedures as Record<string, unknown>;

    expect(procedures.runBatch).toBeDefined();
    expect(procedures.batch).toBeUndefined();
    expect(procedures.hookBatch).toBeUndefined();
  });
});
