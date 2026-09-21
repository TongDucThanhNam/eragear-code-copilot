import { describe, expect, test } from "bun:test";
import { createSupervisorOrchestrationE2eHarness } from "./supervisor-orchestration.e2e-fixture";

describe("supervisor orchestration cancellation e2e", () => {
  test("stops all fake ACP workers and removes every temporary root", async () => {
    const harness = await createSupervisorOrchestrationE2eHarness();
    try {
      const draft = await harness.startDraft({
        userId: "user-1",
        projectId: "project-1",
        projectRoot: "C:/e2e-repo",
        originalIntent: "Cancel deterministic multi-session e2e",
      });
      const started = await harness.approveDraft(draft);
      expect(harness.createdChats).toHaveLength(2);
      expect(harness.activeRoots.size).toBe(0);
      const cancelled = await harness.orchestrator.cancel(
        started.runId,
        "user-1"
      );
      expect(cancelled.status).toBe("cancelled");
      expect(harness.stoppedChats).toHaveLength(2);
      expect(harness.disposedWorkspaceIds).toHaveLength(2);
      expect(harness.activeRoots.size).toBe(0);
      console.log(`SUPERVISOS_CANCEL_WORKERS ${harness.stoppedChats.length}`);
      console.log(`SUPERVISOS_CANCEL_TEMP_ROOTS ${harness.activeRoots.size}`);
    } finally {
      await harness.dispose();
    }
  });

  test("rearms only failed cancellation cleanup and converges on explicit retry", async () => {
    const harness = await createSupervisorOrchestrationE2eHarness({
      failFirstCancellationStop: true,
    });
    try {
      const draft = await harness.startDraft({
        userId: "user-1",
        projectId: "project-1",
        projectRoot: "C:/e2e-repo",
        originalIntent: "Retry a failed durable cancellation cleanup",
      });
      const started = await harness.approveDraft(draft);

      const failedCleanup = await harness.orchestrator.cancel(
        started.runId,
        "user-1"
      );
      const failedDecisionId = failedCleanup.cancellation?.blockingDecisionId;
      const failedAuthorityId = failedCleanup.workflowPlan?.authorityId;
      expect(failedCleanup).toMatchObject({
        status: "paused",
        desiredState: "cancelled",
        cancellation: {
          status: "failed",
          pendingSessionIds: [expect.any(String)],
        },
      });
      expect(failedCleanup.outcome).toBeUndefined();
      expect(failedDecisionId).toBeDefined();

      const cancelled = await harness.orchestrator.cancel(
        started.runId,
        "user-1"
      );

      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.outcome).toBe("cancelled");
      expect(cancelled.workflowPlan?.authorityId).not.toBe(failedAuthorityId);
      expect(
        cancelled.decisions.find(
          (decision) => decision.decisionId === failedDecisionId
        )?.status
      ).toBe("cancelled");
      expect(new Set(harness.stoppedChats).size).toBe(2);
      expect(harness.disposedWorkspaceIds).toHaveLength(2);

      const stopAttempts = harness.stoppedChats.length;
      const replayed = await harness.orchestrator.cancel(
        started.runId,
        "user-1"
      );
      expect(replayed.revision).toBe(cancelled.revision);
      expect(replayed.outcome).toBe("cancelled");
      expect(harness.stoppedChats).toHaveLength(stopAttempts);
    } finally {
      await harness.dispose();
    }
  });
});
