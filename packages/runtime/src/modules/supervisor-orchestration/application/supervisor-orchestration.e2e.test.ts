import { describe, expect, test } from "bun:test";
import {
  createSupervisorOrchestrationE2eHarness,
  findWorkflowEffectForPrompt,
} from "./supervisor-orchestration.e2e-fixture";

describe("supervisor orchestration deterministic e2e", () => {
  test("runs two fake ACP workers in parallel and waits before dependent work", async () => {
    const harness = await createSupervisorOrchestrationE2eHarness();
    try {
      const draft = await harness.startDraft({
        userId: "user-1",
        projectId: "project-1",
        projectRoot: "C:/e2e-repo",
        originalIntent: "Run deterministic multi-session e2e",
      });
      expect(draft.status).toBe("awaiting_approval");
      expect(harness.reasonerPrompts).toHaveLength(1);
      expect(harness.createdChats).toHaveLength(0);
      const started = await harness.approveDraft(draft);
      expect(harness.createdChats).toHaveLength(2);
      expect(new Set(harness.createdChats).size).toBe(2);
      expect(new Set(harness.createdSessions).size).toBe(2);
      expect(
        started.tasks.find((task) => task.taskId === "dependent-c")?.attempts
      ).toHaveLength(0);
      expect(
        harness.prompts.every(
          (prompt) =>
            prompt.workflow.owner === "worker" &&
            prompt.workflow.effectId.length > 0 &&
            prompt.workflow.authorityId.length > 0
        )
      ).toBeTrue();
      console.log(`SUPERVISOS_E2E_WORKERS ${harness.createdChats.join(",")}`);
      await harness.recordSuccess(started.runId, "parallel-a");
      expect(harness.createdChats).toHaveLength(2);
      await harness.recordSuccess(started.runId, "parallel-b");
      expect(harness.createdChats).toHaveLength(3);
      console.log("SUPERVISOS_E2E_DEPENDENCY_WAIT passed");
      const completed = await harness.recordSuccess(
        started.runId,
        "dependent-c"
      );
      expect(completed.status).toBe("completed");
      expect(completed.finalVerification[0]?.exitCode).toBe(0);
      expect(harness.activeRoots.size).toBe(0);
      const effects = await harness.journal.listEffects(started.runId);
      expect(
        effects.filter((effect) => effect.effectType === "start_turn")
      ).toHaveLength(3);
      expect(
        effects.every(
          (effect) =>
            effect.status === "succeeded" || effect.status === "cancelled"
        )
      ).toBeTrue();
      console.log("SUPERVISOS_E2E_INTEGRATION safe");
      console.log("SUPERVISOS_E2E_COMPLETE completed");
    } finally {
      await harness.dispose();
    }
  });

  test("persists an uncertain dispatch sent before acknowledgement and never resends it blindly", async () => {
    const harness = await createSupervisorOrchestrationE2eHarness({
      crashAfterDispatchTaskId: "parallel-a",
    });
    try {
      const draft = await harness.startDraft({
        userId: "user-1",
        projectId: "project-1",
        projectRoot: "C:/e2e-repo",
        originalIntent: "Prove dispatch crash reconciliation",
      });
      const started = await harness.approveDraft(draft);
      const crashPrompt = harness.prompts.find(
        (prompt) => prompt.workflow.workItemId === "parallel-a"
      );
      expect(crashPrompt).toBeDefined();
      const effects = await harness.journal.listEffects(started.runId);
      const uncertain = findWorkflowEffectForPrompt(
        effects,
        crashPrompt as NonNullable<typeof crashPrompt>
      );
      expect(uncertain).toMatchObject({
        effectType: "start_turn",
        status: "uncertain",
      });
      expect(
        effects.some(
          (effect) =>
            effect.effectType === "inspect_uncertain_turn" &&
            effect.status === "succeeded"
        )
      ).toBeTrue();
      expect(
        started.tasks.find((task) => task.taskId === "parallel-a")
      ).toMatchObject({
        status: "needs_user",
        attempts: [{ status: "interrupted" }],
      });
      expect(
        harness.prompts.filter(
          (prompt) => prompt.workflow.workItemId === "parallel-a"
        )
      ).toHaveLength(1);
      await harness.workflowRuntime.tick();
      expect(
        harness.prompts.filter(
          (prompt) => prompt.workflow.workItemId === "parallel-a"
        )
      ).toHaveLength(1);
    } finally {
      await harness.dispose();
    }
  });
});
