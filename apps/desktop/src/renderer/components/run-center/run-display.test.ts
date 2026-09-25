import { describe, expect, test } from "bun:test";
import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import {
  describeRunVerificationSummary,
  getRunAttentionItems,
  getRunCurrentActivity,
  getRunDisplayTitle,
  getRunProgress,
  getRunStatusPresentation,
  getRunVerificationSummary,
  getRunWaitingRows,
  getWaitTimeView,
  isTerminalSupervisosRun,
  selectRunsForGroup,
} from "./run-display";
import { createRunFixture, createTaskFixture } from "./test-fixtures";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");

describe("run display projection", () => {
  test("prefers the Goal contract title and never shows raw ids as titles", () => {
    const run = createRunFixture({
      sourceGoalContract: {
        intakeId: "intake-1",
        revisionId: "rev-1",
        hash: "a".repeat(64),
        contract: {
          title: "Ship the export flow",
          objective: "Ship it safely",
          lockedStrategicDecisions: [],
          assumptions: [],
          nonGoals: [],
          changeBoundary: [],
          acceptanceCriteria: [
            {
              criterionId: "c-1",
              statement: "Exports work",
              evidence: "machine",
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
        criterionResolutions: [],
      },
      tasks: [createTaskFixture({ title: "First task" })],
    });
    expect(getRunDisplayTitle(run)).toBe("Ship the export flow");
    const fallback = createRunFixture({
      tasks: [createTaskFixture({ title: "First task" })],
    });
    expect(getRunDisplayTitle(fallback)).toBe("First task");
  });

  test("summarizes progress from actual task evidence", () => {
    const run = createRunFixture({
      tasks: [
        createTaskFixture({ taskId: "t1", status: "completed" }),
        createTaskFixture({ taskId: "t2", status: "running" }),
        createTaskFixture({
          taskId: "t3",
          status: "blocked",
          dependencies: ["t2"],
        }),
        createTaskFixture({ taskId: "t4", status: "failed" }),
        createTaskFixture({ taskId: "t5", status: "cancelled" }),
      ],
    });
    expect(getRunProgress(run)).toEqual({
      completed: 1,
      failed: 1,
      active: 1,
      waiting: 1,
      total: 5,
    });
  });

  test("presents needs-user as attention, never as failure", () => {
    const run = createRunFixture({ status: "needs_user" });
    expect(getRunStatusPresentation(run).tone).toBe("attention");
    expect(getRunStatusPresentation(run).tone).not.toBe("failed");
    expect(getRunCurrentActivity(run).headline).toBe("Needs you to continue");
  });

  test("describes cancellation in progress distinctly from a terminal cancellation", () => {
    const cancelling = createRunFixture({
      status: "paused",
      cancellation: {
        status: "running",
        pendingSessionCount: 1,
        pendingWorkspaceCount: 0,
      },
    });
    expect(getRunStatusPresentation(cancelling).kind).toBe("cancelling");
    expect(isTerminalSupervisosRun(cancelling)).toBe(false);
    const blocked = createRunFixture({
      status: "paused",
      cancellation: {
        status: "failed",
        pendingSessionCount: 2,
        pendingWorkspaceCount: 1,
      },
    });
    const presentation = getRunStatusPresentation(blocked);
    expect(presentation.kind).toBe("cancellation_blocked");
    expect(presentation.tone).toBe("failed");
  });

  test("keeps terminal runs free of stale waiting rows", () => {
    const run = createRunFixture({
      status: "completed",
      capacityWaits: [
        {
          waitId: "wait-1",
          owner: "task",
          taskId: "t1",
          attemptId: "a1",
          agentId: "agent-1",
          kind: "quota_exhausted",
          retryAt: "2026-09-22T18:00:00.000Z",
          resetAt: "2026-09-23T00:00:00.000Z",
        },
      ],
    });
    expect(getRunWaitingRows(run, [run])).toEqual([]);
    expect(getRunAttentionItems(run)).toEqual([]);
  });

  test("names capacity wait causes, owners, and keeps reset vs retry distinct", () => {
    const run = createRunFixture({
      status: "waiting_capacity",
      tasks: [
        createTaskFixture({
          taskId: "t1",
          title: "Write tests",
          status: "waiting_capacity",
        }),
      ],
      capacityWaits: [
        {
          waitId: "wait-1",
          owner: "task",
          taskId: "t1",
          attemptId: "a1",
          agentId: "agent-a",
          kind: "quota_exhausted",
          retryAt: "2026-09-22T12:10:00.000Z",
          resetAt: "2026-09-22T18:00:00.000Z",
        },
        {
          waitId: "wait-2",
          owner: "manager",
          agentId: "manager-1",
          kind: "auth_required",
          retryAt: "invalid-date",
        },
      ],
    });
    const rows = getRunWaitingRows(run, [run]);
    expect(rows).toHaveLength(2);
    const quota = rows[0];
    expect(quota?.cause).toBe("quota");
    expect(quota?.ownerLabel).toContain("Write tests");
    expect(quota?.waitingOnHuman).toBe(false);
    const quotaTimes = getWaitTimeView(quota, NOW);
    expect(quotaTimes.retry?.text).toBe("in ~10m");
    expect(quotaTimes.reset?.text).toBe("in ~6h");
    const auth = rows[1];
    expect(auth?.cause).toBe("auth");
    expect(auth?.waitingOnHuman).toBe(true);
    expect(auth?.ownerLabel).toContain("Manager");
    expect(getWaitTimeView(auth, NOW).retry?.valid).toBe(false);
  });

  test("explains dependency waits with upstream task titles", () => {
    const run = createRunFixture({
      tasks: [
        createTaskFixture({
          taskId: "t1",
          title: "Research",
          status: "running",
        }),
        createTaskFixture({
          taskId: "t2",
          title: "Implement",
          status: "blocked",
          dependencies: ["t1"],
        }),
      ],
    });
    const rows = getRunWaitingRows(run, [run]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cause).toBe("dependency");
    expect(rows[0]?.reason).toContain("Research");
    expect(rows[0]?.taskId).toBe("t2");
  });

  test("reports a repository wait when a queued writer is blocked by another run", () => {
    const queued = createRunFixture({
      runId: "run-queued",
      status: "queued",
      tasks: [
        createTaskFixture({
          taskId: "t1",
          executionMode: "write",
          status: "ready",
        }),
      ],
    });
    const owner = createRunFixture({
      runId: "run-owner",
      status: "running",
      tasks: [
        createTaskFixture({
          taskId: "t1",
          executionMode: "write",
          status: "running",
          attempts: [
            {
              attemptId: "a1",
              chatId: "chat-1",
              agentId: "agent-1",
              status: "running",
              verification: [],
            },
          ],
        }),
      ],
    });
    const rows = getRunWaitingRows(queued, [queued, owner]);
    expect(rows.filter((row) => row.cause === "repository")).toHaveLength(1);
    expect(rows.find((row) => row.cause === "repository")?.reason).toContain(
      "Implement feature"
    );
    const otherProject = createRunFixture({
      runId: "run-owner",
      projectId: "other",
    });
    expect(
      getRunWaitingRows(queued, [queued, otherProject]).filter(
        (row) => row.cause === "repository"
      )
    ).toEqual([]);
  });

  test("collects plan approval, decisions, user gates, and machine gates with distinct authority", () => {
    const run = createRunFixture({
      status: "awaiting_approval",
      plan: {
        version: 2,
        hash: "b".repeat(64),
        summary: "Exact plan",
        envelope: {
          goal: "Do it",
          fileScopes: ["src/a.ts"],
          verificationCommands: ["bun test"],
          successCriteria: ["works"],
          permissionScopes: [],
          destructiveActions: [],
          delivery: {
            createCommit: true,
            targetBranch: "main",
            targetHead: "abc",
            allowDefaultBranch: false,
          },
        },
      },
      decisions: [
        {
          decisionId: "decision-accept",
          kind: "goal_criteria_acceptance",
          status: "open",
          prompt: "Accept criterion c-1?",
          createdAt: "2026-09-21T10:00:00.000Z",
          criterionIds: ["c-1"],
        },
        {
          decisionId: "decision-question",
          kind: "product_ambiguity",
          status: "open",
          prompt: "Which option?",
          createdAt: "2026-09-21T10:00:00.000Z",
        },
      ],
      gates: [
        {
          gateId: "gate-scope",
          taskId: "t1",
          attemptId: "a1",
          kind: "scope",
          status: "pending",
        },
        {
          gateId: "gate-drift",
          taskId: "t1",
          attemptId: "a1",
          kind: "baseline_drift",
          status: "pending",
        },
      ],
    });
    const items = getRunAttentionItems(run);
    const kinds = new Map(items.map((item) => [item.id, item]));
    expect(kinds.get("plan:2:bbbbbbbbbbbb")?.authority).toBe("user");
    const accept = kinds.get("decision:decision-accept");
    expect(accept?.actions.map((action) => action.id)).toEqual([
      "accept",
      "waive",
    ]);
    const question = kinds.get("decision:decision-question");
    expect(question?.actions.map((action) => action.id)).toEqual(["answer"]);
    const scopeGate = kinds.get("gate:gate-scope");
    expect(scopeGate?.authority).toBe("user");
    expect(scopeGate?.actions.map((action) => action.id)).toEqual([
      "approve-gate",
      "reject-gate",
    ]);
    const driftGate = kinds.get("gate:gate-drift");
    expect(driftGate?.authority).toBe("machine");
    expect(driftGate?.actions).toEqual([]);
    expect(driftGate?.detail).toContain("not by user approval");
  });

  test("links worker-chat attention instead of inventing a second authority", () => {
    const run = createRunFixture({
      status: "needs_user",
      decisions: [
        {
          decisionId: "decision-other",
          kind: "product_ambiguity",
          status: "answered",
          prompt: "resolved",
          createdAt: "2026-09-21T10:00:00.000Z",
        },
      ],
      tasks: [
        createTaskFixture({
          taskId: "t1",
          title: "Stuck worker task",
          status: "needs_user",
          attempts: [
            {
              attemptId: "a1",
              chatId: "worker-chat-9",
              agentId: "agent-1",
              status: "terminal",
              verification: [],
            },
          ],
        }),
      ],
    });
    const items = getRunAttentionItems(run);
    const workerItem = items.find((item) => item.kind === "worker_chat");
    expect(workerItem?.authority).toBe("worker-chat");
    expect(workerItem?.chatId).toBe("worker-chat-9");
    expect(workerItem?.actions[0]?.id).toBe("open-chat");
  });

  test("flags exhausted attempt budgets as replan-required attention", () => {
    const run = createRunFixture({
      limits: { maxAttemptsPerTask: 2 },
      tasks: [
        createTaskFixture({
          taskId: "t1",
          status: "failed",
          attempts: [
            {
              attemptId: "a1",
              chatId: "chat-1",
              agentId: "agent-1",
              status: "terminal",
              verification: [],
            },
            {
              attemptId: "a2",
              chatId: "chat-2",
              agentId: "agent-1",
              status: "terminal",
              verification: [],
            },
          ],
        }),
      ],
    });
    const items = getRunAttentionItems(run);
    const budget = items.find((item) => item.kind === "retry_budget");
    expect(budget?.actions[0]?.id).toBe("replan");
    expect(budget?.detail).toContain("new plan");
  });

  test("groups runs honestly across filters", () => {
    const runs: SupervisorRunClientUpdate[] = [
      createRunFixture({ runId: "r-attention", status: "needs_user" }),
      createRunFixture({ runId: "r-running", status: "running" }),
      createRunFixture({
        runId: "r-waiting",
        status: "waiting_capacity",
      }),
      createRunFixture({ runId: "r-history", status: "completed" }),
    ];
    expect(
      selectRunsForGroup(runs, "attention").map((run) => run.runId)
    ).toEqual(["r-attention"]);
    expect(selectRunsForGroup(runs, "running").map((run) => run.runId)).toEqual(
      ["r-running"]
    );
    expect(selectRunsForGroup(runs, "waiting").map((run) => run.runId)).toEqual(
      ["r-waiting"]
    );
    expect(selectRunsForGroup(runs, "history").map((run) => run.runId)).toEqual(
      ["r-history"]
    );
  });
});

describe("run verification summary", () => {
  test("empty checks are none, never a pass", () => {
    const summary = getRunVerificationSummary(createRunFixture({}));
    expect(summary.state).toBe("none");
    expect(summary.total).toBe(0);
    expect(describeRunVerificationSummary(summary).label).toBe(
      "No aggregate verification recorded"
    );
  });

  test("all zero exits are the only passing claim", () => {
    const summary = getRunVerificationSummary(
      createRunFixture({
        finalVerification: [
          { command: "bun run check:ast", exitCode: 0 },
          { command: "bun test", exitCode: 0 },
        ],
      })
    );
    expect(summary.state).toBe("passed");
    expect(describeRunVerificationSummary(summary)).toMatchObject({
      label: "Aggregate verification passed (2 checks)",
      tone: "success",
    });
  });

  test("a null exit leaves verification incomplete, not passed or failed", () => {
    const summary = getRunVerificationSummary(
      createRunFixture({
        finalVerification: [{ command: "bun test", exitCode: null }],
      })
    );
    expect(summary).toMatchObject({ state: "incomplete", pending: 1 });
    expect(describeRunVerificationSummary(summary).label).toBe(
      "Aggregate verification incomplete (0 passed, 1 without a result)"
    );
  });

  test("a failing verifier stays failed and the run status is untouched", () => {
    const completed = createRunFixture({
      status: "completed",
      finalVerification: [
        { command: "bun run check:ast", exitCode: 0 },
        { command: "bun test", exitCode: 2 },
      ],
    });
    expect(completed.status).toBe("completed");
    const summary = getRunVerificationSummary(completed);
    expect(summary).toMatchObject({ state: "failed", failed: 1, total: 2 });
    expect(describeRunVerificationSummary(summary).label).toBe(
      "Aggregate verification failed (1 of 2 checks)"
    );
    expect(getRunCurrentActivity(completed).headline).toBe(
      "Completed with failed verification"
    );
  });

  test("worker attempt verification is not final verification", () => {
    const run = createRunFixture({
      status: "completed",
      tasks: [
        createTaskFixture({
          status: "completed",
          attempts: [
            {
              attemptId: "att-1",
              chatId: "chat-1",
              agentId: "worker-1",
              status: "terminal",
              verification: [{ command: "bun test", exitCode: 0 }],
            },
          ],
        }),
      ],
    });
    expect(getRunVerificationSummary(run).state).toBe("none");
  });

  test("answered criteria decisions count as user review, open ones do not", () => {
    const decision = (status: "open" | "answered") => ({
      decisionId: `dec-${status}`,
      kind: "goal_criteria_acceptance",
      status,
      prompt: "Was it met?",
      createdAt: "2026-09-22T10:00:00.000Z",
      criterionIds: ["crit-1"],
    });
    const summary = getRunVerificationSummary(
      createRunFixture({
        decisions: [decision("answered"), decision("open")],
      })
    );
    expect(summary.userResolvedCriteria).toBe(1);
    expect(summary.state).toBe("none");
  });

  test("completed activity headline follows the evidence, not the status alone", () => {
    expect(
      getRunCurrentActivity(createRunFixture({ status: "completed" })).headline
    ).toBe("Completed without aggregate verification");
    expect(
      getRunCurrentActivity(
        createRunFixture({
          status: "completed",
          finalVerification: [{ command: "bun test", exitCode: null }],
        })
      ).headline
    ).toBe("Completed — verification incomplete");
  });
});
