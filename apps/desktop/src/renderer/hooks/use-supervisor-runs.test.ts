import { describe, expect, test } from "bun:test";
import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import {
  selectSupervisorRunsForChat,
  upsertSupervisorRun,
} from "./use-supervisor-runs";

function run(
  runId: string,
  revision: number,
  originatingChatId?: string
): SupervisorRunClientUpdate {
  return {
    runId,
    revision,
    ...(originatingChatId ? { originatingChatId } : {}),
    status: "running",
    priority: "normal",
    tasks: [],
    gates: [],
    capacityWaits: [],
    decisions: [],
    finalVerification: [],
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: `2026-07-11T00:0${revision}:00.000Z`,
  };
}

describe("useSupervisorRuns state helpers", () => {
  test("applies newer revisions and ignores stale subscription delivery", () => {
    const current = [run("run-1", 2)];
    expect(upsertSupervisorRun(current, run("run-1", 1))).toBe(current);
    expect(upsertSupervisorRun(current, run("run-1", 3))[0]?.revision).toBe(3);
  });

  test("selects originating and project-level runs for the active chat", () => {
    const selected = selectSupervisorRunsForChat(
      [run("run-1", 1, "chat-1"), run("run-2", 1, "chat-2"), run("run-3", 1)],
      "chat-1"
    );
    expect(selected.map((item) => item.runId)).toEqual(["run-1", "run-3"]);
  });
});
