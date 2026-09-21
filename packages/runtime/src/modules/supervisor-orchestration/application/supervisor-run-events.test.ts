import { describe, expect, test } from "bun:test";
import { SUPERVISOR_RUN_UPDATE_SCHEMA } from "@eragear-code-copilot/shared";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { createClientSafeSupervisorRunUpdate } from "./supervisor-run-events.service";

describe("supervisor run client events", () => {
  test("maps strict status evidence without prompts, secrets, transcripts, or patches", () => {
    const secret = "sk-secret-value";
    const run = createSupervisorRunFixture({
      originalIntent: `Do work with ${secret}`,
      constraints: [`Never print ${secret}`],
    });
    run.activity = "executing";
    const firstTask = run.tasks[0];
    if (!firstTask) {
      throw new Error("Run event fixture task missing");
    }
    firstTask.activity = "verification";
    const update = createClientSafeSupervisorRunUpdate(run);
    const json = JSON.stringify(update);

    expect(SUPERVISOR_RUN_UPDATE_SCHEMA.parse(update)).toEqual(update);
    expect(update.status).toBe("running");
    expect(update.tasks[0]?.status).toBe("reviewing");
    expect(json).not.toContain(secret);
    expect(json).not.toContain("originalIntent");
    expect(json).not.toContain("constraints");
    expect(json).not.toContain("storageRef");
    expect(json).not.toContain("resultText");
    expect(json).not.toContain("rawTranscript");
  });

  test("projects internal uncertain attempts as client-safe running", () => {
    const run = createSupervisorRunFixture();
    const firstTask = run.tasks[0];
    if (!firstTask) {
      throw new Error("Run event fixture task missing");
    }
    firstTask.attempts = [
      {
        attemptId: "attempt-1",
        chatId: "chat-1",
        agentId: "agent-1",
        status: "uncertain",
        idempotencyKey: "dispatch-1",
        uncertaintyId: "private-uncertainty-marker",
        startedAt: "2026-07-11T00:01:00.000Z",
      },
    ];
    firstTask.activeAttemptId = "attempt-1";

    const update = createClientSafeSupervisorRunUpdate(run);
    const serialized = JSON.stringify(update);

    expect(SUPERVISOR_RUN_UPDATE_SCHEMA.parse(update)).toEqual(update);
    expect(update.tasks[0]?.attempts[0]?.status).toBe("running");
    expect(serialized).not.toContain("uncertain");
    expect(serialized).not.toContain("private-uncertainty-marker");
  });

  test("projects cancellation progress without exposing session or workspace identifiers", () => {
    const run = createSupervisorRunFixture({ status: "paused" });
    run.desiredState = "cancelled";
    run.cancellation = {
      status: "failed",
      pendingSessionIds: ["private-session-1", "private-session-2"],
      pendingWorkspaceIds: ["private-workspace-1"],
      blockingDecisionId: "decision-cancel-failure",
    };
    run.blockingDecisionId = "decision-cancel-failure";
    run.decisions.push({
      decisionId: "decision-cancel-failure",
      kind: "classifier_uncertain",
      status: "open",
      prompt: "Cleanup failed",
      createdAt: run.updatedAt,
    });

    const update = createClientSafeSupervisorRunUpdate(run);
    const serialized = JSON.stringify(update);

    expect(SUPERVISOR_RUN_UPDATE_SCHEMA.parse(update)).toEqual(update);
    expect(update.status).toBe("paused");
    expect(update.cancellation).toEqual({
      status: "failed",
      pendingSessionCount: 2,
      pendingWorkspaceCount: 1,
      blockingDecisionId: "decision-cancel-failure",
    });
    expect(serialized).not.toContain("private-session");
    expect(serialized).not.toContain("private-workspace");
  });
});
