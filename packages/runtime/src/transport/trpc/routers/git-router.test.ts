import { describe, expect, test } from "bun:test";
import { gitRouter } from "./git";

describe("gitRouter", () => {
  test("keeps extracted repository procedures on the flat git interface", () => {
    const procedures = gitRouter._def.procedures as Record<string, unknown>;
    const record = gitRouter._def.record as Record<string, unknown>;

    expect(procedures.summary).toBeDefined();
    expect(procedures.changes).toBeDefined();
    expect(record.repository).toBeUndefined();
    expect(record.gitRepository).toBeUndefined();
  });

  test("keeps extracted checkpoint procedures under the existing checkpoints namespace", () => {
    const procedures = gitRouter._def.procedures as Record<string, unknown>;
    const record = gitRouter._def.record as Record<string, unknown>;

    expect(record.checkpoints).toBeDefined();
    expect(procedures["checkpoints.list"]).toBeDefined();
    expect(procedures["checkpoints.create"]).toBeDefined();
    expect(procedures["checkpoints.restore"]).toBeDefined();
    expect(record.checkpoint).toBeUndefined();
    expect(record.gitCheckpoints).toBeUndefined();
  });
});
