import { describe, expect, test } from "bun:test";
import { createSupervisorOrchestrationE2eHarness } from "./supervisor-orchestration.e2e-fixture";

describe("supervisor orchestration cancellation e2e", () => {
  test("stops all fake ACP workers and removes every temporary root", async () => {
    const harness = createSupervisorOrchestrationE2eHarness();
    const started = await harness.orchestrator.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/e2e-repo",
      originalIntent: "Cancel deterministic multi-session e2e",
    });
    expect(harness.activeRoots.size).toBe(2);
    const cancelled = await harness.orchestrator.cancel(
      started.runId,
      "user-1"
    );
    expect(cancelled.status).toBe("cancelled");
    expect(harness.stoppedChats).toHaveLength(2);
    expect(harness.activeRoots.size).toBe(0);
    console.log(`SUPERVISOS_CANCEL_WORKERS ${harness.stoppedChats.length}`);
    console.log(`SUPERVISOS_CANCEL_TEMP_ROOTS ${harness.activeRoots.size}`);
  });
});
