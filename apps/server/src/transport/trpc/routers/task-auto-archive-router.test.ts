import { describe, expect, test } from "bun:test";
import { taskAutoArchiveRouter } from "./task-auto-archive";

describe("taskAutoArchiveRouter", () => {
  test("keeps extracted status procedures on the flat task auto-archive interface", () => {
    const procedures = taskAutoArchiveRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.getStatus).toBeDefined();
    expect(procedures.status).toBeUndefined();
    expect(procedures.taskAutoArchiveStatus).toBeUndefined();
  });

  test("keeps extracted settings procedures on the flat task auto-archive interface", () => {
    const procedures = taskAutoArchiveRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.updateSettings).toBeDefined();
    expect(procedures.settings).toBeUndefined();
    expect(procedures.taskAutoArchiveSettings).toBeUndefined();
  });

  test("keeps extracted run procedures on the flat task auto-archive interface", () => {
    const procedures = taskAutoArchiveRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.runNow).toBeDefined();
    expect(procedures.run).toBeUndefined();
    expect(procedures.taskAutoArchiveRun).toBeUndefined();
  });
});
