import { describe, expect, test } from "bun:test";
import {
  reduceSupervisorRun,
  type SupervisorRunDurableEvent,
} from "./supervisor-run.reducer";
import { createSupervisorRunFixture } from "./supervisor-run.test-fixture";

describe("reduceSupervisorRun", () => {
  test("is deterministic and ignores an already processed durable event", () => {
    const run = createSupervisorRunFixture();
    const event: SupervisorRunDurableEvent = {
      type: "run_desired_state_set",
      eventId: "event-pause-1",
      occurredAt: "2026-07-11T00:01:00.000Z",
      desiredState: "paused",
    };

    const first = reduceSupervisorRun(run, event);
    const replayed = reduceSupervisorRun(first, event);
    const independentlyReduced = reduceSupervisorRun(run, event);

    expect(first).toEqual(independentlyReduced);
    expect(replayed).toEqual(first);
    expect(first.revision).toBe(run.revision + 1);
    expect(replayed.revision).toBe(first.revision);
    expect(first.status).toBe("paused");
    expect(first.processedEventIds).toContain(event.eventId);
  });

  test("records agent evidence without completing the work item", () => {
    const run = createSupervisorRunFixture();
    const started = reduceSupervisorRun(run, {
      type: "work_item_attempt_started",
      eventId: "event-attempt-started",
      occurredAt: "2026-07-11T00:01:00.000Z",
      taskId: "task-a",
      attempt: {
        attemptId: "attempt-1",
        chatId: "chat-1",
        agentId: "agent-1",
        status: "running",
        idempotencyKey: "run-1:task-a:1",
        startedAt: "2026-07-11T00:01:00.000Z",
      },
    });
    const withResult = reduceSupervisorRun(started, {
      type: "agent_result_recorded",
      eventId: "event-agent-result",
      occurredAt: "2026-07-11T00:02:00.000Z",
      taskId: "task-a",
      attemptId: "attempt-1",
      result: {
        semanticStatus: "succeeded",
        reason: "Agent reports the requested edit is complete",
        outcomeSummary: "Implementation finished",
        files: {
          touched: ["packages/runtime/src/index.ts"],
          created: [],
          deleted: [],
          renamed: [],
        },
        verification: [],
        toolFailureSummary: [],
        unresolvedPermissions: [],
        agentId: "agent-1",
        chatId: "chat-1",
        startedAt: "2026-07-11T00:01:00.000Z",
        finishedAt: "2026-07-11T00:02:00.000Z",
      },
    });

    expect(withResult.tasks[0]?.outcome).toBeUndefined();
    expect(withResult.tasks[0]?.status).toBe("reviewing");
    expect(withResult.tasks[0]?.activeAttemptId).toBeUndefined();
    expect(withResult.tasks[0]?.attempts[0]?.result?.semanticStatus).toBe(
      "succeeded"
    );

    const verified = reduceSupervisorRun(withResult, {
      type: "work_item_verification_set",
      eventId: "event-work-item-verified",
      occurredAt: "2026-07-11T00:03:00.000Z",
      taskId: "task-a",
      verification: {
        verificationId: "verification-task-a",
        status: "passed",
        evidenceRefs: ["evidence-test-task-a"],
      },
    });
    const accepted = reduceSupervisorRun(verified, {
      type: "work_item_acceptance_set",
      eventId: "event-work-item-accepted",
      occurredAt: "2026-07-11T00:04:00.000Z",
      taskId: "task-a",
      acceptance: "machine_verified",
    });
    const completed = reduceSupervisorRun(accepted, {
      type: "work_item_outcome_recorded",
      eventId: "event-work-item-completed",
      occurredAt: "2026-07-11T00:05:00.000Z",
      taskId: "task-a",
      outcome: "succeeded",
    });
    expect(completed.tasks[0]?.outcome).toBe("succeeded");
    expect(completed.tasks[0]?.status).toBe("completed");
    expect(completed.tasks[0]?.verification?.evidenceRefs).toEqual([
      "evidence-test-task-a",
    ]);
  });

  test("persists dispatch authority, capacity lease, and uncertain delivery facts", () => {
    const leased = reduceSupervisorRun(createSupervisorRunFixture(), {
      type: "work_item_dispatch_set",
      eventId: "event-dispatch-leased",
      occurredAt: "2026-07-11T00:01:00.000Z",
      taskId: "task-a",
      dispatch: {
        dispatchId: "dispatch-task-a-1",
        state: "leased",
        effectId: "effect-start-task-a-1",
      },
      capacityLease: {
        leaseId: "lease-agent-1",
        agentIdentityId: "agent-1",
        issuedAt: "2026-07-11T00:01:00.000Z",
        expiresAt: "2026-07-11T00:06:00.000Z",
      },
    });
    const started = reduceSupervisorRun(leased, {
      type: "work_item_attempt_started",
      eventId: "event-attempt-started-for-uncertainty",
      occurredAt: "2026-07-11T00:02:00.000Z",
      taskId: "task-a",
      attempt: {
        attemptId: "attempt-uncertain",
        chatId: "chat-uncertain",
        agentId: "agent-1",
        status: "running",
        idempotencyKey: "run-1:task-a:uncertain",
        dispatchEffectId: "effect-start-task-a-1",
        promptHash: "a".repeat(64),
        startedAt: "2026-07-11T00:02:00.000Z",
      },
    });
    const uncertain = reduceSupervisorRun(started, {
      type: "work_item_attempt_uncertain",
      eventId: "event-attempt-uncertain",
      occurredAt: "2026-07-11T00:03:00.000Z",
      taskId: "task-a",
      attemptId: "attempt-uncertain",
      uncertaintyId: "uncertain-effect-start-task-a-1",
      dispatchEffectId: "effect-start-task-a-1",
      promptHash: "a".repeat(64),
    });

    expect(uncertain.tasks[0]?.dispatch?.effectId).toBe(
      "effect-start-task-a-1"
    );
    expect(uncertain.tasks[0]?.capacityLease?.leaseId).toBe("lease-agent-1");
    expect(uncertain.tasks[0]?.attempts[0]?.status).toBe("uncertain");
    expect(uncertain.tasks[0]?.status).toBe("running");
  });

  test("requires durable final verification evidence before run success", () => {
    const run = createSupervisorRunFixture();
    for (const task of run.tasks) {
      task.outcome = "succeeded";
      task.acceptance = "user_accepted";
      task.status = "completed";
      Reflect.deleteProperty(task, "activity");
      if (task.executionMode === "write") {
        task.integration = {
          integrationId: `integration-${task.taskId}`,
          status: "succeeded",
          workspaceId: `workspace-${task.taskId}`,
        };
      }
    }

    expect(() =>
      reduceSupervisorRun(run, {
        type: "run_outcome_recorded",
        eventId: "event-run-success-without-final-evidence",
        occurredAt: "2026-07-11T00:06:00.000Z",
        outcome: "succeeded",
      })
    ).toThrow("without final verification acceptance");

    const verified = reduceSupervisorRun(run, {
      type: "run_final_verification_set",
      eventId: "event-final-verification",
      occurredAt: "2026-07-11T00:06:00.000Z",
      verification: {
        verificationId: "verification-final",
        status: "passed",
        evidenceRefs: ["evidence-final-suite"],
      },
    });
    const finished = reduceSupervisorRun(verified, {
      type: "run_outcome_recorded",
      eventId: "event-run-success",
      occurredAt: "2026-07-11T00:07:00.000Z",
      outcome: "succeeded",
    });

    expect(finished.outcome).toBe("succeeded");
    expect(finished.status).toBe("completed");
  });

  test("rejects successful work without a terminal successful agent result", () => {
    const run = createSupervisorRunFixture();

    expect(() =>
      reduceSupervisorRun(run, {
        type: "work_item_outcome_recorded",
        eventId: "event-unverified-success",
        occurredAt: "2026-07-11T00:01:00.000Z",
        taskId: "task-a",
        outcome: "succeeded",
      })
    ).toThrow("without a terminal successful agent result");
  });

  test("rejects reopening or rewriting a terminal work item", () => {
    const run = createSupervisorRunFixture();
    const task = run.tasks[0];
    if (!task) {
      throw new Error("Fixture task missing");
    }
    task.outcome = "failed";
    task.status = "failed";

    expect(() =>
      reduceSupervisorRun(run, {
        type: "work_item_attempt_started",
        eventId: "event-reopen-terminal-task",
        occurredAt: "2026-07-11T00:01:00.000Z",
        taskId: task.taskId,
        attempt: {
          attemptId: "attempt-reopen",
          chatId: "chat-1",
          agentId: "agent-1",
          status: "running",
          idempotencyKey: "run-1:task-a:reopen",
          startedAt: "2026-07-11T00:01:00.000Z",
        },
      })
    ).toThrow("already terminal");

    expect(() =>
      reduceSupervisorRun(run, {
        type: "work_item_outcome_recorded",
        eventId: "event-rewrite-terminal-task",
        occurredAt: "2026-07-11T00:01:00.000Z",
        taskId: task.taskId,
        outcome: "cancelled",
      })
    ).toThrow("already terminal");
  });

  test("rejects run success before every work item succeeds", () => {
    expect(() =>
      reduceSupervisorRun(createSupervisorRunFixture(), {
        type: "run_outcome_recorded",
        eventId: "event-premature-run-success",
        occurredAt: "2026-07-11T00:01:00.000Z",
        outcome: "succeeded",
      })
    ).toThrow("before every task succeeds");
  });

  test("rejects every terminal run outcome while an attempt remains active", () => {
    const run = reduceSupervisorRun(createSupervisorRunFixture(), {
      type: "work_item_attempt_started",
      eventId: "event-active-attempt",
      occurredAt: "2026-07-11T00:01:00.000Z",
      taskId: "task-a",
      attempt: {
        attemptId: "attempt-active",
        chatId: "chat-1",
        agentId: "agent-1",
        status: "running",
        idempotencyKey: "run-1:task-a:active",
        startedAt: "2026-07-11T00:01:00.000Z",
      },
    });

    expect(() =>
      reduceSupervisorRun(run, {
        type: "run_outcome_recorded",
        eventId: "event-finish-with-active-attempt",
        occurredAt: "2026-07-11T00:02:00.000Z",
        outcome: "failed",
      })
    ).toThrow("has an active attempt");
  });
});
