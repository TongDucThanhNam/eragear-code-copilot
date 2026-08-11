import { describe, expect, test } from "bun:test";
import { createSupervisorOrchestrationE2eHarness } from "./supervisor-orchestration.e2e-fixture";

describe("supervisor orchestration deterministic e2e", () => {
  test("runs two fake ACP workers in parallel and waits before dependent work", async () => {
    const harness = createSupervisorOrchestrationE2eHarness();
    const draft = await harness.orchestrator.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/e2e-repo",
      originalIntent: "Run deterministic multi-session e2e",
    });
    expect(draft.status).toBe("awaiting_approval");
    expect(harness.createdChats).toHaveLength(0);
    const started = await harness.approveDraft(draft);
    expect(harness.createdChats).toHaveLength(2);
    expect(new Set(harness.createdChats).size).toBe(2);
    expect(new Set(harness.createdSessions).size).toBe(2);
    expect(
      started.tasks.find((task) => task.taskId === "dependent-c")?.attempts
    ).toHaveLength(0);
    console.log(`SUPERVISOS_E2E_WORKERS ${harness.createdChats.join(",")}`);
    await harness.recordSuccess(started.runId, "parallel-a");
    expect(harness.createdChats).toHaveLength(2);
    await harness.recordSuccess(started.runId, "parallel-b");
    expect(harness.createdChats).toHaveLength(3);
    console.log("SUPERVISOS_E2E_DEPENDENCY_WAIT passed");
    const completed = await harness.recordSuccess(started.runId, "dependent-c");
    expect(completed.status).toBe("completed");
    expect(completed.finalVerification[0]?.exitCode).toBe(0);
    expect(harness.activeRoots.size).toBe(0);
    console.log("SUPERVISOS_E2E_INTEGRATION safe");
    console.log("SUPERVISOS_E2E_COMPLETE completed");
  });
});
