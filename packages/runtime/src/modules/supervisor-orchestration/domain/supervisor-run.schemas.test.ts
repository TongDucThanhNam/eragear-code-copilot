import { describe, expect, test } from "bun:test";
import {
  createDefaultSupervisorRunLimits,
  SUPERVISOR_RUN_LIMIT_CAPS,
  SupervisorRunStateSchema,
} from "./supervisor-run.schemas";
import { createSupervisorRunFixture } from "./supervisor-run.test-fixture";

describe("SupervisorRunStateSchema", () => {
  test("accepts a strict versioned run/task/attempt aggregate", () => {
    const run = createSupervisorRunFixture();
    expect(run.schemaVersion).toBe(3);
    expect(run.desiredState).toBe("running");
    expect(run.phase).toBe("executing");
    expect(run.limits.maxConcurrency).toBe(2);
    expect(run.tasks.map((task) => task.taskId)).toEqual(["task-a", "task-b"]);
  });

  test("rejects unknown fields and limits above hard caps", () => {
    expect(
      SupervisorRunStateSchema.safeParse({
        ...createSupervisorRunFixture(),
        unsafeExtra: true,
      }).success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...createSupervisorRunFixture(),
        limits: {
          ...createDefaultSupervisorRunLimits(),
          maxConcurrency: SUPERVISOR_RUN_LIMIT_CAPS.maxConcurrency + 1,
        },
      }).success
    ).toBeFalse();
  });

  test("rejects duplicate, unknown, self, and cyclic dependencies", () => {
    const base = createSupervisorRunFixture();
    const cases = [
      [base.tasks[0], { ...base.tasks[1], taskId: "task-a" }],
      [base.tasks[0], { ...base.tasks[1], dependencies: ["missing"] }],
      [base.tasks[0], { ...base.tasks[1], dependencies: ["task-b"] }],
      [
        { ...base.tasks[0], dependencies: ["task-b"] },
        { ...base.tasks[1], dependencies: ["task-a"] },
      ],
    ];
    for (const tasks of cases) {
      expect(
        SupervisorRunStateSchema.safeParse({ ...base, tasks }).success
      ).toBeFalse();
    }
  });

  test("rejects attempt counts above the run limit and invalid terminal evidence", () => {
    const base = createSupervisorRunFixture({
      limits: {
        ...createDefaultSupervisorRunLimits(),
        maxAttemptsPerTask: 1,
      },
    });
    const attempt = {
      attemptId: "attempt-1",
      chatId: "chat-1",
      agentId: "agent-1",
      idempotencyKey: "run-1:task-a:1",
      status: "terminal" as const,
      startedAt: "2026-07-11T00:00:00.000Z",
    };
    expect(
      SupervisorRunStateSchema.safeParse({
        ...base,
        tasks: [
          {
            ...base.tasks[0],
            attempts: [attempt, { ...attempt, attemptId: "attempt-2" }],
          },
          base.tasks[1],
        ],
      }).success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...base,
        tasks: [{ ...base.tasks[0], attempts: [attempt] }, base.tasks[1]],
      }).success
    ).toBeFalse();
  });

  test("requires phase and outcome to become terminal together", () => {
    const run = createSupervisorRunFixture();
    expect(
      SupervisorRunStateSchema.safeParse({ ...run, phase: "finished" }).success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({ ...run, outcome: "succeeded" })
        .success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...run,
        phase: "finished",
        outcome: "succeeded",
        status: "completed",
        activity: undefined,
      }).success
    ).toBeTrue();
  });

  test("requires activeAttemptId to reference the sole active attempt", () => {
    const run = createSupervisorRunFixture();
    const attempt = {
      attemptId: "attempt-active",
      chatId: "chat-active",
      agentId: "agent-1",
      idempotencyKey: "run-1:task-a:active",
      status: "running" as const,
      startedAt: "2026-07-11T00:00:00.000Z",
    };
    const task = {
      ...run.tasks[0],
      status: "running" as const,
      activity: "agent_turn" as const,
      attempts: [attempt],
    };
    expect(
      SupervisorRunStateSchema.safeParse({
        ...run,
        tasks: [task, run.tasks[1]],
      }).success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...run,
        tasks: [{ ...task, activeAttemptId: attempt.attemptId }, run.tasks[1]],
      }).success
    ).toBeTrue();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...run,
        tasks: [
          {
            ...task,
            activeAttemptId: attempt.attemptId,
            attempts: [
              attempt,
              {
                ...attempt,
                attemptId: "attempt-second",
                idempotencyKey: "run-1:task-a:second",
              },
            ],
          },
          run.tasks[1],
        ],
      }).success
    ).toBeFalse();
  });

  test("rejects terminal task and run outcomes that retain active attempts", () => {
    const base = createSupervisorRunFixture();
    const attempt = {
      attemptId: "attempt-active",
      chatId: "chat-active",
      agentId: "agent-1",
      idempotencyKey: "run-1:task-a:active",
      status: "running" as const,
      startedAt: "2026-07-11T00:00:00.000Z",
    };
    const activeTask = {
      ...base.tasks[0],
      status: "running" as const,
      activity: "agent_turn" as const,
      activeAttemptId: attempt.attemptId,
      attempts: [attempt],
    };
    const activeRun = {
      ...base,
      status: "running" as const,
      activity: "executing" as const,
      tasks: [activeTask, base.tasks[1]],
    };

    expect(
      SupervisorRunStateSchema.safeParse({
        ...activeRun,
        tasks: [
          {
            ...activeTask,
            status: "cancelled",
            outcome: "cancelled",
            activity: undefined,
          },
          base.tasks[1],
        ],
      }).success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...activeRun,
        desiredState: "cancelled",
        phase: "finished",
        outcome: "cancelled",
        status: "cancelled",
        activity: undefined,
      }).success
    ).toBeFalse();
  });

  test("accepts explicit workflow authority and evidence facts", () => {
    const run = createSupervisorRunFixture();
    const parsed = SupervisorRunStateSchema.parse({
      ...run,
      workflowPlan: {
        goalRevisionId: "goal-revision-4",
        authorityId: "plan-authority-4",
        status: "approved",
        planVersion: 4,
      },
      workflowFinalVerification: {
        verificationId: "verification-final",
        status: "not_started",
        evidenceRefs: [],
      },
      cancellation: {
        status: "pending",
        pendingSessionIds: ["session-1"],
        pendingWorkspaceIds: ["workspace-1"],
      },
      finalization: {
        status: "pending",
      },
      tasks: [
        {
          ...run.tasks[0],
          status: "queued",
          activity: "dispatching",
          dispatch: {
            dispatchId: "dispatch-1",
            state: "start_requested",
            effectId: "effect-start-1",
          },
          capacityLease: {
            leaseId: "lease-1",
            agentIdentityId: "agent-1",
            issuedAt: "2026-07-11T00:00:00.000Z",
            expiresAt: "2026-07-11T00:05:00.000Z",
          },
          verification: {
            verificationId: "verification-task-a",
            status: "not_started",
            evidenceRefs: [],
          },
          integration: {
            integrationId: "integration-task-a",
            status: "not_required",
          },
          acceptance: "pending",
        },
        run.tasks[1],
      ],
    });

    expect(parsed.workflowPlan?.authorityId).toBe("plan-authority-4");
    expect(parsed.tasks[0]?.dispatch?.effectId).toBe("effect-start-1");
  });

  test("rejects incomplete leases, uncertainty, and machine acceptance evidence", () => {
    const run = createSupervisorRunFixture();
    const invalidLease = {
      ...run.tasks[0],
      status: "queued" as const,
      activity: "dispatching" as const,
      dispatch: {
        dispatchId: "dispatch-1",
        state: "leased" as const,
      },
    };
    const invalidUncertainAttempt = {
      attemptId: "attempt-uncertain",
      chatId: "chat-uncertain",
      agentId: "agent-1",
      idempotencyKey: "run-1:task-a:uncertain",
      status: "uncertain" as const,
      startedAt: "2026-07-11T00:00:00.000Z",
    };
    const invalidAcceptance = {
      ...run.tasks[0],
      status: "reviewing" as const,
      activity: "verification" as const,
      verification: {
        verificationId: "verification-task-a",
        status: "passed" as const,
        evidenceRefs: [],
      },
      acceptance: "machine_verified" as const,
    };

    expect(
      SupervisorRunStateSchema.safeParse({
        ...run,
        tasks: [invalidLease, run.tasks[1]],
      }).success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...run,
        tasks: [
          {
            ...run.tasks[0],
            status: "running",
            activity: "agent_turn",
            activeAttemptId: invalidUncertainAttempt.attemptId,
            attempts: [invalidUncertainAttempt],
          },
          run.tasks[1],
        ],
      }).success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...run,
        tasks: [invalidAcceptance, run.tasks[1]],
      }).success
    ).toBeFalse();
  });

  test("requires every blocker to reference an open durable decision", () => {
    const run = createSupervisorRunFixture();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...run,
        status: "needs_user",
        blockingDecisionId: "decision-missing",
      }).success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...run,
        status: "needs_user",
        blockingDecisionId: "decision-answered",
        decisions: [
          {
            decisionId: "decision-answered",
            kind: "product_ambiguity",
            status: "answered",
            prompt: "Choose an option",
            answer: "Option A",
            createdAt: "2026-07-11T00:00:00.000Z",
            answeredAt: "2026-07-11T00:01:00.000Z",
            answeredByUserId: "user-1",
          },
        ],
      }).success
    ).toBeFalse();
  });

  test("requires failed workflow facts to expose a blocking decision", () => {
    const run = createSupervisorRunFixture();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...run,
        workflowPlan: {
          goalRevisionId: "goal-revision-1",
          authorityId: "authority-1",
          status: "failed",
        },
      }).success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...run,
        tasks: [
          {
            ...run.tasks[0],
            status: "needs_user",
            verification: {
              verificationId: "verification-task-a",
              status: "failed",
              evidenceRefs: [],
            },
          },
          run.tasks[1],
        ],
      }).success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...run,
        phase: "finalizing",
        status: "needs_user",
        activity: "finalizing",
        finalization: { status: "failed" },
      }).success
    ).toBeFalse();
  });

  test("requires typed Goal Contract coverage plus machine and explicit user evidence before success", () => {
    const base = createSupervisorRunFixture();
    const answeredAt = "2026-07-11T00:05:00.000Z";
    const evidencedTask = (task: (typeof base.tasks)[number]) => ({
      ...task,
      outcome: "succeeded" as const,
      status: "completed" as const,
      acceptance: "machine_verified" as const,
      verification: {
        verificationId: `verification-${task.taskId}`,
        status: "passed" as const,
        evidenceRefs: [`evidence-${task.taskId}`],
      },
      integration: {
        integrationId: `integration-${task.taskId}`,
        status: "not_required" as const,
      },
    });
    const typed = {
      ...base,
      sourceGoalContract: {
        intakeId: "intake-1",
        revisionId: "contract-1",
        revision: 1,
        hash: "a".repeat(64),
        createdAt: base.createdAt,
        contract: {
          title: "Typed goal",
          objective: "Complete only with criterion evidence",
          lockedStrategicDecisions: [],
          assumptions: [],
          nonGoals: [],
          changeBoundary: ["packages/runtime"],
          acceptanceCriteria: [
            {
              criterionId: "machine-criterion",
              statement: "Trusted checks pass",
              evidence: "machine" as const,
            },
            {
              criterionId: "user-criterion",
              statement: "The semantic result is accepted",
              evidence: "user" as const,
            },
          ],
          trustedVerificationCommands: ["bun test"],
          authority: {
            scopedCodeChange: "auto" as const,
            architectureChange: "ask" as const,
            dependencyChange: "ask" as const,
            destructiveAction: "ask" as const,
            finalIntegration: "ask" as const,
          },
          unresolvedQuestions: [],
        },
      },
      tasks: [
        {
          ...evidencedTask(base.tasks[0] as (typeof base.tasks)[number]),
          criterionIds: ["machine-criterion"],
        },
        {
          ...evidencedTask(base.tasks[1] as (typeof base.tasks)[number]),
          criterionIds: ["user-criterion"],
        },
      ],
      decisions: [
        {
          decisionId: "accept-user-criterion",
          kind: "goal_criteria_acceptance" as const,
          status: "answered" as const,
          prompt: "Accept the semantic criterion",
          answer: "Accepted after review",
          criterionIds: ["user-criterion"],
          createdAt: base.createdAt,
          answeredAt,
          answeredByUserId: base.userId,
        },
      ],
      goalCriterionResolutions: [
        {
          criterionId: "user-criterion",
          resolution: "user_accepted" as const,
          decisionId: "accept-user-criterion",
          resolvedAt: answeredAt,
          resolvedByUserId: base.userId,
        },
      ],
    };

    expect(SupervisorRunStateSchema.safeParse(typed).success).toBeTrue();
    const successful = {
      ...typed,
      phase: "finished" as const,
      outcome: "succeeded" as const,
      status: "completed" as const,
      activity: undefined,
    };
    expect(SupervisorRunStateSchema.safeParse(successful).success).toBeTrue();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...successful,
        goalCriterionResolutions: [],
      }).success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...successful,
        tasks: successful.tasks.map((task, index) =>
          index === 0
            ? {
                ...task,
                acceptance: "user_accepted" as const,
                verification: undefined,
              }
            : task
        ),
      }).success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...successful,
        tasks: successful.tasks.map((task, index) =>
          index === 0
            ? { ...task, verificationCommands: ["bun run unrelated-check"] }
            : task
        ),
      }).success
    ).toBeFalse();
  });

  test("upgrades legacy needs-user statuses into resolvable decisions", () => {
    const current = createSupervisorRunFixture();
    const legacyTask = { ...current.tasks[0], status: "needs_user" };
    Reflect.deleteProperty(legacyTask, "blockingDecisionId");
    const legacy = {
      ...current,
      schemaVersion: 2,
      status: "needs_user",
      decisions: [],
      tasks: [legacyTask, current.tasks[1]],
    };
    Reflect.deleteProperty(legacy, "blockingDecisionId");

    const upgraded = SupervisorRunStateSchema.parse(legacy);
    const blockerIds = [
      upgraded.blockingDecisionId,
      upgraded.tasks[0]?.blockingDecisionId,
    ];
    expect(blockerIds.every(Boolean)).toBeTrue();
    expect(
      blockerIds.every((decisionId) =>
        upgraded.decisions.some(
          (decision) =>
            decision.decisionId === decisionId && decision.status === "open"
        )
      )
    ).toBeTrue();
  });
});
