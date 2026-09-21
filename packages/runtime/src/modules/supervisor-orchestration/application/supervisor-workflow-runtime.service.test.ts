import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  computeWorkflowPayloadHash,
  type WorkflowEffectIntentInput,
  type WorkflowJsonValue,
} from "#runtime/modules/workflow";
import { closeSqliteStorage } from "#runtime/platform/storage/sqlite-db";
import { resetStoragePathCacheForTests } from "#runtime/platform/storage/storage-path";
import { WorkflowJournalSqliteAdapter } from "../../workflow/infra/workflow-journal.repository.sqlite";
import {
  type SupervisorRunState,
  SupervisorRunStateSchema,
} from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { transitionSupervisorRun } from "../domain/supervisor-run.transitions";
import { SupervisorRunSqliteRepository } from "../infra/supervisor-run.repository.sqlite";
import { computeSupervisorPromptHash } from "./ports/supervisor-effect-prompt-dispatch.port";
import {
  resolveRunVerificationCommands,
  type SupervisorWorkflowEffectFacade,
  SupervisorWorkflowRuntimeService,
} from "./supervisor-workflow-runtime.service";

const NOW = "2026-08-18T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

describe("SupervisorWorkflowRuntimeService", () => {
  let previousStorageDir: string | undefined;
  let tempStorageDir = "";
  let journal: WorkflowJournalSqliteAdapter;
  let runs: SupervisorRunSqliteRepository;

  beforeEach(async () => {
    previousStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    await closeSqliteStorage();
    tempStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "eragear-workflow-runtime-")
    );
    process.env.ERAGEAR_STORAGE_DIR = tempStorageDir;
    resetStoragePathCacheForTests();
    journal = new WorkflowJournalSqliteAdapter();
    runs = new SupervisorRunSqliteRepository();
  });

  afterEach(async () => {
    await closeSqliteStorage();
    resetStoragePathCacheForTests();
    if (previousStorageDir === undefined) {
      Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
    } else {
      process.env.ERAGEAR_STORAGE_DIR = previousStorageDir;
    }
    await removeTempDirWithRetry(tempStorageDir);
  });

  test("atomically materializes, dispatches, and projects a typed handler result", async () => {
    const run = createPlanningRun();
    await createRun(run);
    let dispatchedPrompt = "";
    const runtime = createRuntime({
      requestPlan(context) {
        expect(context.effect.status).toBe("started");
        expect(context.preparedPrompt?.effectId).toBe(context.effect.effectId);
        expect(context.preparedPrompt?.authorityId).toBe("authority-1");
        dispatchedPrompt = context.preparedPrompt?.text ?? "";
        expect(context.preparedPrompt?.promptHash).toBe(
          computeSupervisorPromptHash(dispatchedPrompt)
        );
        return Promise.resolve({ kind: "plan_requested" });
      },
    });

    const result = await runtime.tick();

    expect(result).toMatchObject({
      materializedEffects: 1,
      claimedEffects: 1,
      succeededEffects: 1,
    });
    expect(dispatchedPrompt.length).toBeGreaterThan(0);
    const saved = await runs.get(run.runId, run.userId);
    const events = await journal.listEvents(run.runId);
    const effects = await journal.listEffects(run.runId);
    expect(saved?.workflowPlan?.status).toBe("requested");
    expect(saved?.revision).toBe(2);
    expect(events.map((event) => event.revision)).toEqual([0, 1, 2]);
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      authorityId: "authority-1",
      status: "succeeded",
      resultEventId: events.at(-1)?.eventId,
    });
    expect(effects[0]?.idempotencyKey).not.toContain("authority-1:");
  });

  test("revokes queued effects when pause or cancellation invalidates their authority", async () => {
    for (const desiredState of ["paused", "cancelled"] as const) {
      const run = createPlanningRun(desiredState, `run-${desiredState}`);
      const oldEffect = createEffect({
        effectId: `effect-old-${desiredState}`,
        run,
        authorityId: "superseded-authority",
        effectType: "request_plan",
        intent: {
          type: "request_plan",
          runId: run.runId,
          goalRevisionId: "goal-1",
          dedupeKey: `old-${desiredState}`,
        },
      });
      await createRun(run, [oldEffect]);

      await createRuntime().tick();

      expect((await journal.getEffect(oldEffect.effectId))?.status).toBe(
        "cancelled"
      );
      if (desiredState === "cancelled") {
        expect((await runs.get(run.runId, run.userId))?.outcome).toBe(
          "cancelled"
        );
      }
    }
  });

  test("correlates a sent-before-ack start effect without an effect attemptId", async () => {
    const effectId = "effect-start-without-attempt-id";
    const run = createPausedAttemptRun(effectId);
    const effect = createEffect({
      effectId,
      run,
      effectType: "start_turn",
      intent: {
        type: "start_turn",
        runId: run.runId,
        workItemId: "task-a",
        dispatchId: "dispatch-1",
        leaseId: "lease-1",
        agentIdentityId: "agent-1",
        dedupeKey: "start-task-a",
      },
      promptHash: "b".repeat(64),
    });
    await createRun(run, [effect]);
    const uncertain = await startAndLoseAcknowledgement(effect.effectId);
    expect(uncertain.attemptId).toBeUndefined();

    await createRuntime().recoverStartup({
      releasedEffects: [],
      uncertainEffects: [uncertain],
    });

    const saved = await runs.get(run.runId, run.userId);
    expect(saved?.tasks[0]?.attempts[0]).toMatchObject({
      attemptId: "attempt-1",
      status: "uncertain",
      uncertaintyId: effectId,
      dispatchEffectId: effectId,
      promptHash: "b".repeat(64),
    });
    expect(saved?.tasks[0]?.activeAttemptId).toBe("attempt-1");
    expect(saved?.tasks[0]?.outcome).toBeUndefined();
    expect(saved?.tasks[0]?.attempts[0]?.finishedAt).toBeUndefined();
  });

  test("projects a failed handler into an open blocking decision", async () => {
    const run = createPlanningRun();
    await createRun(run);
    const runtime = createRuntime({
      requestPlan() {
        throw new Error("manager subscription is unavailable");
      },
    });

    await runtime.tick();

    const saved = await runs.get(run.runId, run.userId);
    const failedEffect = (await journal.listEffects(run.runId)).find(
      (effect) => effect.effectType === "request_plan"
    );
    expect(failedEffect?.status).toBe("failed");
    expect(saved?.workflowPlan).toMatchObject({
      status: "failed",
      blockingDecisionId: `${failedEffect?.effectId}-failure`,
    });
    expect(saved?.blockingDecisionId).toBe(`${failedEffect?.effectId}-failure`);
    expect(
      saved?.decisions.find(
        (decision) => decision.decisionId === saved.blockingDecisionId
      )
    ).toMatchObject({
      status: "open",
      prompt: "manager subscription is unavailable",
    });
  });

  test("atomically rejects a stale success when authority changes during effect IO", async () => {
    const run = createPlanningRun();
    await createRun(run);
    const runtime = createRuntime({
      async requestPlan() {
        const current = await runs.get(run.runId, run.userId);
        if (!current) {
          throw new Error("Missing authority-race fixture");
        }
        const rotated = transitionSupervisorRun(current, {
          expectedRevision: current.revision,
          now: NOW,
          mutate(draft) {
            if (!draft.workflowPlan) {
              throw new Error("Missing workflow plan facts");
            }
            draft.workflowPlan.authorityId = "authority-2";
          },
        });
        await journal.commitRunTransition({
          expectedRevision: current.revision,
          snapshot: rotated,
          event: {
            eventId: "authority-rotated-during-effect",
            runId: rotated.runId,
            revision: rotated.revision,
            eventType: "workflow_authority_rotated",
            payloadVersion: 1,
            payload: { authorityId: "authority-2" },
            occurredAtMs: NOW_MS,
          },
        });
        return { kind: "plan_requested" };
      },
    });

    await runtime.tick();

    const saved = await runs.get(run.runId, run.userId);
    const effect = (await journal.listEffects(run.runId)).find(
      (candidate) => candidate.effectType === "request_plan"
    );
    expect(saved?.workflowPlan?.authorityId).toBe("authority-2");
    expect(effect).toMatchObject({
      status: "failed",
      lastError: {
        code: "WORKFLOW_EFFECT_AUTHORITY_REVOKED",
        authorityId: "authority-1",
      },
    });
  });

  test("detects an expired live started effect and escalates instead of resending", async () => {
    const run = createPlanningRun();
    run.workflowPlan = {
      goalRevisionId: "goal-1",
      authorityId: "authority-1",
      status: "requested",
    };
    const effect = createEffect({
      effectId: "effect-live-stale-plan",
      run,
      effectType: "request_plan",
      intent: {
        type: "request_plan",
        runId: run.runId,
        goalRevisionId: "goal-1",
        dedupeKey: "request-plan-goal-1",
      },
    });
    await createRun(run, [effect]);
    await markStarted(effect.effectId, NOW_MS - 10_000, NOW_MS - 1);
    let planDispatches = 0;
    const runtime = createRuntime({
      requestPlan() {
        planDispatches += 1;
        return Promise.resolve({ kind: "plan_requested" });
      },
      requestDecision() {
        return Promise.resolve({
          kind: "decision_requested",
          decisionId: `${effect.effectId}-failure`,
        });
      },
    });

    const tick = await runtime.tick();

    const saved = await runs.get(run.runId, run.userId);
    expect(tick.uncertainEffects).toBeGreaterThanOrEqual(1);
    expect(planDispatches).toBe(0);
    expect((await journal.getEffect(effect.effectId))?.status).toBe(
      "uncertain"
    );
    expect(saved?.workflowPlan).toMatchObject({
      status: "failed",
      blockingDecisionId: `${effect.effectId}-failure`,
    });
    expect(saved?.decisions).toContainEqual(
      expect.objectContaining({
        decisionId: `${effect.effectId}-failure`,
        status: "open",
      })
    );
  });

  test("stops a quota-suspended binding durably before exact resume", async () => {
    const run = createWaitingAttemptRun();
    await createRun(run);
    const calls: string[] = [];
    let resumeCalls = 0;
    const runtime = createRuntime({
      stopAgentSession(context) {
        expect(context.effect.status).toBe("started");
        expect(context.intent).toMatchObject({
          purpose: "capacity_suspension",
          waitId: "wait-task-a",
          sessionId: "chat-waiting",
          workItemId: "task-a",
          attemptId: "attempt-waiting",
          parentAuthorityId: "authority-1",
        });
        calls.push("stop");
        return Promise.resolve({
          kind: "agent_session_stopped",
          sessionId: "chat-waiting",
        });
      },
      resumeSession() {
        calls.push("resume");
        resumeCalls += 1;
        throw new Error("quota exhausted again during continuation");
      },
    });

    await runtime.tick();
    expect(calls).toEqual(["stop"]);
    expect(resumeCalls).toBe(0);
    expect(
      (await journal.listEffects(run.runId)).find(
        (effect) =>
          effect.effectType === "stop_agent_session" &&
          effect.status === "succeeded"
      )
    ).toBeDefined();

    await runtime.tick();

    const saved = await runs.get(run.runId, run.userId);
    const attempt = saved?.tasks[0]?.attempts[0];
    expect(calls).toEqual(["stop", "resume"]);
    expect(resumeCalls).toBe(1);
    expect(attempt).toMatchObject({
      attemptId: "attempt-waiting",
      status: "waiting_capacity",
    });
    expect(Date.parse(attempt?.retryAt ?? "")).toBeGreaterThan(NOW_MS);
    expect(saved?.tasks[0]?.notBefore).toBe(attempt?.retryAt);
    expect(
      (await journal.listEffects(run.runId)).find(
        (effect) => effect.effectType === "resume_session"
      )?.status
    ).toBe("failed");
  });

  test("fails closed without losing the exact binding when durable suspension fails", async () => {
    const run = createWaitingAttemptRun();
    await createRun(run);
    let resumeCalls = 0;
    const runtime = createRuntime({
      stopAgentSession() {
        throw new Error("session process could not be stopped");
      },
      resumeSession() {
        resumeCalls += 1;
        return Promise.resolve({
          kind: "session_resumed",
          taskId: "task-a",
          attemptId: "attempt-waiting",
        });
      },
    });

    await runtime.tick();

    const saved = await runs.get(run.runId, run.userId);
    const stopEffect = (await journal.listEffects(run.runId)).find(
      (effect) => effect.effectType === "stop_agent_session"
    );
    expect(stopEffect?.status).toBe("failed");
    expect(resumeCalls).toBe(0);
    expect(saved?.capacityWaits).toHaveLength(1);
    expect(saved?.tasks[0]?.activeAttemptId).toBe("attempt-waiting");
    expect(saved?.tasks[0]?.attempts[0]).toMatchObject({
      chatId: "chat-waiting",
      agentSessionId: "session-waiting",
      status: "waiting_capacity",
    });
    expect(saved?.tasks[0]?.blockingDecisionId).toBe(
      `${stopEffect?.effectId}-failure`
    );
    expect(saved?.decisions).toContainEqual(
      expect.objectContaining({
        decisionId: `${stopEffect?.effectId}-failure`,
        status: "open",
        prompt: "session process could not be stopped",
      })
    );
  });

  test("finishes a persisted capacity suspension while the run is paused", async () => {
    const run = createWaitingAttemptRun();
    run.desiredState = "paused";
    run.status = "paused";
    await createRun(run);
    let stopCalls = 0;
    const runtime = createRuntime({
      stopAgentSession() {
        stopCalls += 1;
        return Promise.resolve({
          kind: "agent_session_stopped",
          sessionId: "chat-waiting",
        });
      },
    });

    await runtime.tick();

    const saved = await runs.get(run.runId, run.userId);
    const effects = await journal.listEffects(run.runId);
    expect(stopCalls).toBe(1);
    expect(saved?.desiredState).toBe("paused");
    expect(saved?.tasks[0]?.attempts[0]?.status).toBe("waiting_capacity");
    expect(effects).toContainEqual(
      expect.objectContaining({
        effectType: "stop_agent_session",
        status: "succeeded",
      })
    );
    expect(
      effects.some((effect) => effect.effectType === "resume_session")
    ).toBe(false);
  });

  test("projects a crashed capacity suspension as uncertain without exact-resuming", async () => {
    const run = createWaitingAttemptRun();
    const parentAuthorityId = "authority-1";
    const authorityId = stableTestId(
      "capacity-suspension-authority",
      parentAuthorityId,
      "wait-task-a"
    );
    const effect = createEffect({
      effectId: "effect-capacity-stop-crashed",
      run,
      authorityId,
      effectType: "stop_agent_session",
      intent: {
        type: "stop_agent_session",
        purpose: "capacity_suspension",
        runId: run.runId,
        sessionId: "chat-waiting",
        waitId: "wait-task-a",
        parentAuthorityId,
        workItemId: "task-a",
        attemptId: "attempt-waiting",
        dedupeKey:
          "run-1:stop_agent_session:capacity_suspension:wait-task-a:chat-waiting",
      },
    });
    await createRun(run, [effect]);
    await markStarted(effect.effectId, NOW_MS - 10_000, NOW_MS - 1);
    let resumeCalls = 0;
    let stopCalls = 0;
    const runtime = createRuntime({
      stopAgentSession() {
        stopCalls += 1;
        return Promise.resolve({
          kind: "agent_session_stopped",
          sessionId: "chat-waiting",
        });
      },
      resumeSession() {
        resumeCalls += 1;
        return Promise.resolve({
          kind: "session_resumed",
          taskId: "task-a",
          attemptId: "attempt-waiting",
        });
      },
      requestDecision(context) {
        return Promise.resolve({
          kind: "decision_requested",
          decisionId: String(context.intent.decisionId),
          taskId: "task-a",
        });
      },
    });

    await runtime.tick();

    const saved = await runs.get(run.runId, run.userId);
    expect((await journal.getEffect(effect.effectId))?.status).toBe(
      "uncertain"
    );
    expect(stopCalls).toBe(0);
    expect(resumeCalls).toBe(0);
    expect(saved?.capacityWaits).toHaveLength(1);
    expect(saved?.tasks[0]?.attempts[0]).toMatchObject({
      chatId: "chat-waiting",
      agentSessionId: "session-waiting",
      status: "waiting_capacity",
    });
    expect(saved?.tasks[0]?.blockingDecisionId).toBe(
      `${effect.effectId}-failure`
    );
  });

  test("opens typed criterion decisions instead of finalizing without contract evidence", async () => {
    for (const evidence of ["machine", "user"] as const) {
      const run = createGoalContractExecutionRun(evidence, false);
      await createRun(run);

      await createRuntime().tick();

      const saved = await runs.get(run.runId, run.userId);
      const decision = saved?.decisions.find(
        (candidate) => candidate.decisionId === saved.blockingDecisionId
      );
      expect(saved?.phase).toBe("executing");
      expect(decision).toMatchObject({
        kind:
          evidence === "machine"
            ? "goal_criterion_evidence"
            : "goal_criteria_acceptance",
        status: "open",
        criterionIds: [`criterion-${evidence}`],
      });
      expect(
        (await journal.listEffects(run.runId)).some(
          (effect) => effect.effectType === "create_final_commit"
        )
      ).toBeFalse();
    }
  });

  test("creates the final commit only after an explicit typed user criterion resolution", async () => {
    const run = createGoalContractExecutionRun("user", true);
    expect(resolveRunVerificationCommands(run, ["unrelated-check"])).toEqual([
      "bun test",
    ]);
    run.phase = "finalizing";
    run.status = "completing";
    run.activity = "finalizing";
    run.workflowFinalVerification = {
      verificationId: "final-verification",
      status: "accepted",
      evidenceRefs: ["final-evidence"],
    };
    run.finalization = { status: "pending" };
    await createRun(SupervisorRunStateSchema.parse(run));
    let commitCalls = 0;

    await createRuntime({
      createFinalCommit() {
        commitCalls += 1;
        return Promise.resolve({
          kind: "final_commit_created",
          commitSha: "commit-with-criteria",
        });
      },
    }).tick();

    const saved = await runs.get(run.runId, run.userId);
    expect(commitCalls).toBe(1);
    expect(saved).toMatchObject({
      phase: "finished",
      outcome: "succeeded",
      finalCommitSha: "commit-with-criteria",
    });
  });

  function createRuntime(
    overrides: Partial<SupervisorWorkflowEffectFacade> = {}
  ): SupervisorWorkflowRuntimeService {
    return new SupervisorWorkflowRuntimeService({
      runs,
      journal,
      unitOfWork: journal,
      effects: createEffectFacade(overrides),
      now: () => NOW,
      maxReconcilePasses: 1,
      maxEffectsPerPass: 32,
    });
  }

  async function createRun(
    run: SupervisorRunState,
    effects: WorkflowEffectIntentInput[] = []
  ): Promise<void> {
    await journal.commitRunTransition({
      expectedRevision: null,
      snapshot: run,
      event: {
        eventId: `${run.runId}-created`,
        runId: run.runId,
        revision: 0,
        eventType: "run_created",
        payloadVersion: 1,
        payload: { runId: run.runId },
        occurredAtMs: Date.parse(run.updatedAt),
      },
      effects,
    });
  }

  async function startAndLoseAcknowledgement(effectId: string) {
    await markStarted(effectId, NOW_MS - 10_000, NOW_MS - 1);
    const uncertain = await journal.markStaleStartedDispatchesUncertain({
      effectTypes: ["start_turn"],
      nowMs: NOW_MS,
      error: { code: "PROCESS_DIED_AFTER_SEND" },
      includeUnexpired: false,
    });
    if (!uncertain[0]) {
      throw new Error("Expected a stale dispatch fixture");
    }
    return uncertain[0];
  }

  async function markStarted(
    effectId: string,
    startedAtMs: number,
    leaseExpiresAtMs: number
  ): Promise<void> {
    const claimed = await journal.claimDueEffects({
      nowMs: startedAtMs,
      claimToken: `claim-${effectId}`,
      leaseDurationMs: Math.max(1, leaseExpiresAtMs - startedAtMs),
      limit: 1,
    });
    if (!claimed.some((item) => item.effectId === effectId)) {
      throw new Error(`Expected effect claim: ${effectId}`);
    }
    const started = await journal.markEffectStarted({
      effectId,
      claimToken: `claim-${effectId}`,
      startedAtMs,
      leaseExpiresAtMs,
    });
    if (started?.status !== "started") {
      throw new Error(`Expected started effect: ${effectId}`);
    }
  }
});

function createGoalContractExecutionRun(
  evidence: "machine" | "user",
  resolved: boolean
): SupervisorRunState {
  const base = createSupervisorRunFixture({
    runId: `run-goal-${evidence}-${resolved ? "resolved" : "pending"}`,
  });
  const task = base.tasks[0];
  if (!task) {
    throw new Error("Missing Goal Contract task fixture");
  }
  const decisionId = `decision-${evidence}`;
  const resolvedAt = "2026-08-18T11:59:00.000Z";
  return SupervisorRunStateSchema.parse({
    ...base,
    phase: "executing",
    status: "running",
    activity: "executing",
    workflowPlan: {
      goalRevisionId: `goal-revision-${evidence}`,
      authorityId: `goal-authority-${evidence}`,
      status: "approved",
      planVersion: 1,
    },
    sourceGoalContract: {
      intakeId: `intake-${evidence}`,
      revisionId: `contract-${evidence}`,
      revision: 1,
      hash: "a".repeat(64),
      createdAt: "2026-08-18T11:00:00.000Z",
      contract: {
        title: `Goal requiring ${evidence} evidence`,
        objective: "Complete only with durable criterion evidence",
        lockedStrategicDecisions: [],
        assumptions: [],
        nonGoals: [],
        changeBoundary: ["packages/runtime"],
        acceptanceCriteria: [
          {
            criterionId: `criterion-${evidence}`,
            statement: `Provide ${evidence} evidence`,
            evidence,
          },
        ],
        trustedVerificationCommands: ["bun test"],
        authority: {
          scopedCodeChange: "auto",
          architectureChange: "ask",
          dependencyChange: "ask",
          destructiveAction: "ask",
          finalIntegration: "auto",
        },
        unresolvedQuestions: [],
      },
    },
    tasks: [
      {
        ...task,
        dependencies: [],
        criterionIds: [`criterion-${evidence}`],
        changeKinds: [],
        outcome: "succeeded",
        status: "completed",
        acceptance:
          evidence === "machine" && !resolved
            ? "user_accepted"
            : "machine_verified",
        ...(evidence === "machine" && !resolved
          ? {}
          : {
              verification: {
                verificationId: `verification-${evidence}`,
                status: "passed",
                evidenceRefs: [`evidence-${evidence}`],
              },
            }),
        integration: {
          integrationId: `integration-${evidence}`,
          status: "not_required",
        },
      },
    ],
    decisions:
      evidence === "user" && resolved
        ? [
            {
              decisionId,
              kind: "goal_criteria_acceptance",
              status: "answered",
              prompt: "Explicitly accept the semantic criterion",
              answer: "Accepted after review",
              criterionIds: [`criterion-${evidence}`],
              createdAt: "2026-08-18T11:58:00.000Z",
              answeredAt: resolvedAt,
              answeredByUserId: base.userId,
            },
          ]
        : [],
    goalCriterionResolutions:
      evidence === "user" && resolved
        ? [
            {
              criterionId: `criterion-${evidence}`,
              resolution: "user_accepted",
              decisionId,
              resolvedAt,
              resolvedByUserId: base.userId,
            },
          ]
        : [],
  });
}

function createPlanningRun(
  desiredState: "running" | "paused" | "cancelled" = "running",
  runId = "run-1"
): SupervisorRunState {
  const base = createSupervisorRunFixture();
  return SupervisorRunStateSchema.parse({
    ...base,
    runId,
    desiredState,
    phase: "planning",
    status: desiredState === "running" ? "planning" : "paused",
    activity: desiredState === "running" ? "planning" : undefined,
    workflowPlan: {
      goalRevisionId: "goal-1",
      authorityId: "authority-1",
      status: "missing",
    },
    ...(desiredState === "cancelled"
      ? {
          cancellation: {
            status: "pending",
            pendingSessionIds: [],
            pendingWorkspaceIds: [],
          },
        }
      : {}),
    tasks: [],
  });
}

function createPausedAttemptRun(effectId: string): SupervisorRunState {
  const base = createSupervisorRunFixture();
  const task = base.tasks[0];
  if (!task) {
    throw new Error("Missing task fixture");
  }
  return SupervisorRunStateSchema.parse({
    ...base,
    desiredState: "paused",
    phase: "executing",
    status: "paused",
    activity: undefined,
    workflowPlan: {
      goalRevisionId: "goal-1",
      authorityId: "authority-1",
      status: "approved",
      planVersion: 1,
    },
    tasks: [
      {
        ...task,
        preferredAgentId: "agent-1",
        status: "failed",
        outcome: "failed",
        attempts: [
          {
            attemptId: "attempt-1",
            chatId: "chat-1",
            agentId: "agent-1",
            status: "interrupted",
            idempotencyKey: effectId,
            dispatchEffectId: effectId,
            promptHash: "b".repeat(64),
            startedAt: NOW,
            finishedAt: NOW,
          },
        ],
      },
    ],
  });
}

function createWaitingAttemptRun(): SupervisorRunState {
  const base = createSupervisorRunFixture();
  const task = base.tasks[0];
  if (!task) {
    throw new Error("Missing task fixture");
  }
  return SupervisorRunStateSchema.parse({
    ...base,
    desiredState: "running",
    phase: "executing",
    status: "waiting_capacity",
    activity: "capacity_wait",
    workflowPlan: {
      goalRevisionId: "goal-1",
      authorityId: "authority-1",
      status: "approved",
      planVersion: 1,
    },
    capacityWaits: [
      {
        waitId: "wait-task-a",
        owner: "task",
        taskId: "task-a",
        attemptId: "attempt-waiting",
        agentId: "agent-1",
        kind: "quota_exhausted",
        reason: "quota reset probe is due",
        suspendedAt: "2026-08-18T11:00:00.000Z",
        retryAt: NOW,
        backoffStep: 1,
      },
    ],
    tasks: [
      {
        ...task,
        preferredAgentId: "agent-1",
        status: "waiting_capacity",
        activity: "capacity_wait",
        activeAttemptId: "attempt-waiting",
        notBefore: NOW,
        attempts: [
          {
            attemptId: "attempt-waiting",
            chatId: "chat-waiting",
            agentSessionId: "session-waiting",
            agentId: "agent-1",
            status: "waiting_capacity",
            idempotencyKey: "initial-dispatch",
            retryAt: NOW,
            startedAt: "2026-08-18T11:00:00.000Z",
          },
        ],
      },
    ],
  });
}

function createEffect(input: {
  effectId: string;
  run: SupervisorRunState;
  effectType: string;
  intent: Record<string, WorkflowJsonValue>;
  authorityId?: string;
  promptHash?: string;
}): WorkflowEffectIntentInput {
  const payload = {
    userId: input.run.userId,
    intent: input.intent,
  };
  return {
    effectId: input.effectId,
    authorityId:
      input.authorityId ??
      input.run.workflowPlan?.authorityId ??
      input.run.runId,
    effectType: input.effectType,
    payloadVersion: 1,
    payload,
    payloadHash: computeWorkflowPayloadHash(payload),
    ...(input.promptHash ? { promptHash: input.promptHash } : {}),
    idempotencyKey: String(input.intent.dedupeKey),
    notBeforeMs: NOW_MS - 20_000,
    createdAtMs: NOW_MS - 20_000,
  };
}

function createEffectFacade(
  overrides: Partial<SupervisorWorkflowEffectFacade>
): SupervisorWorkflowEffectFacade {
  const unexpected = (name: string) => () =>
    Promise.reject(new Error(`Unexpected workflow facade call: ${name}`));
  return {
    requestPlan: unexpected("requestPlan"),
    requestCapacity: unexpected("requestCapacity"),
    startTurn: unexpected("startTurn"),
    resumeSession: unexpected("resumeSession"),
    resumeManagerSession: unexpected("resumeManagerSession"),
    inspectUncertainTurn: unexpected("inspectUncertainTurn"),
    runVerification: unexpected("runVerification"),
    requestDecision: unexpected("requestDecision"),
    integrateWorkspace: unexpected("integrateWorkspace"),
    stopAgentSession: unexpected("stopAgentSession"),
    disposeWorkspace: unexpected("disposeWorkspace"),
    createFinalCommit: unexpected("createFinalCommit"),
    ...overrides,
  };
}

function stableTestId(prefix: string, ...parts: string[]): string {
  const hash = createHash("sha256")
    .update(parts.join("\0"), "utf8")
    .digest("hex");
  return `${prefix}-${hash}`;
}

async function removeTempDirWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      if (!(code === "EBUSY" || code === "EPERM")) {
        throw error;
      }
      if (attempt === 9) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
