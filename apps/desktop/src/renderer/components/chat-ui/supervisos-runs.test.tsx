import { describe, expect, test } from "bun:test";
import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import { isUserApprovableSupervisosGate } from "@eragear-code-copilot/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getRunStatusPresentation } from "@/components/run-center/run-display";
import { SupervisosRunsView } from "./supervisos-runs";

function run(
  overrides: Partial<SupervisorRunClientUpdate> = {}
): SupervisorRunClientUpdate {
  return {
    runId: "run-1",
    revision: 3,
    status: "needs_user",
    tasks: [
      {
        taskId: "task-1",
        title: "Implement scoped change",
        role: "implementation",
        executionMode: "write",
        dependencies: ["task-0"],
        status: "needs_user",
        attempts: [
          {
            attemptId: "attempt-1",
            chatId: "worker-chat-1",
            agentId: "agent-1",
            status: "terminal",
            verification: [{ command: "bun test", exitCode: 0 }],
          },
        ],
      },
    ],
    gates: [
      {
        gateId: "gate-1",
        taskId: "task-1",
        attemptId: "attempt-1",
        kind: "scope",
        status: "pending",
      },
    ],
    finalVerification: [],
    priority: overrides.priority ?? "normal",
    capacityWaits: overrides.capacityWaits ?? [],
    decisions: overrides.decisions ?? [],
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:03:00.000Z",
    ...overrides,
  };
}

function render(runs: SupervisorRunClientUpdate[], isLoading = false) {
  const current = runs[0] ?? run();
  const resolved = () => Promise.resolve(current);
  return renderToStaticMarkup(
    createElement(SupervisosRunsView, {
      runs,
      isLoading,
      error: null,
      isPending: false,
      canStart: true,
      start: resolved,
      pause: resolved,
      resume: resolved,
      cancel: resolved,
      replan: resolved,
      approvePlan: resolved,
      requestPlanChanges: resolved,
      answerDecision: resolved,
      setPriority: resolved,
      retryTask: resolved,
      approveGate: resolved,
      rejectGate: resolved,
      chatId: "chat-1",
      onOpenWorker: () => undefined,
      onOpenWorkspace: () => undefined,
      onOpenRunCenter: () => undefined,
    })
  );
}

describe("SupervisosRunsView", () => {
  test("renders an intentional empty state and loading recovery state", () => {
    expect(render([])).toContain("No supervised run yet");
    expect(render([], true)).toContain("Loading runs");
  });

  test("renders dependency status, worker pills, evidence gates, and controls", () => {
    const html = render([run()]);
    expect(html).toContain("Implement scoped change");
    expect(html).toContain("waits for 1");
    // Worker attempt renders as an openable agent pill bound to its chat.
    expect(html).toContain('data-testid="run-agent-pill"');
    expect(html).toContain("Open worker chat for agent-1");
    // The pending scope gate surfaces as a user-approvable attention item.
    expect(html).toContain("Gate: scope");
    expect(html).toContain("Your approval");
    expect(html).toContain("Approve");
    expect(html).toContain("Retry");
    expect(html).toContain("Replan");
    expect(html).toContain("Cancel");
    expect(html).toContain("Workspace");
    expect(html).toContain("Open Run Center");
  });

  test("machine gates are visible but never user-approvable", () => {
    const html = render([
      run({
        gates: [
          {
            gateId: "gate-m",
            taskId: "task-1",
            attemptId: "attempt-1",
            kind: "baseline_drift",
            status: "pending",
          },
        ],
      }),
    ]);
    expect(html).toContain("Machine gate: baseline drift");
    expect(html).toContain("not by user approval");
    expect(isUserApprovableSupervisosGate("deletion")).toBe(true);
    expect(isUserApprovableSupervisosGate("baseline_drift")).toBe(false);
  });

  test("needs_user is attention, not failure, in the semantic badge", () => {
    const presentation = getRunStatusPresentation(run());
    expect(presentation.tone).toBe("attention");
    const html = render([run()]);
    expect(html).toContain('data-status-kind="needs_user"');
  });

  test("renders completed run discovery and never claims verification without evidence", () => {
    const completed = run({
      status: "completed",
      tasks: [],
      gates: [],
      finalVerification: [],
    });
    const html = render([
      completed,
      run({ runId: "run-2", originatingChatId: "chat-9" }),
    ]);
    // An empty check list is not a passing aggregate verification.
    expect(html).toContain("No aggregate verification recorded");
    expect(html).not.toContain("Aggregate verification passed");
    expect(html).not.toContain("Aggregate verification complete");
    expect(html).toContain('data-testid="runs-toggle-all"');
    expect(html).toContain("from other chats");
  });

  test("completed verification note reflects the recorded evidence", () => {
    const cases: Array<{
      finalVerification: Array<{ command: string; exitCode: number | null }>;
      expected: string;
      state: string;
    }> = [
      {
        finalVerification: [
          { command: "bun run check:ast", exitCode: 0 },
          { command: "bun test src", exitCode: 0 },
        ],
        expected: "Aggregate verification passed (2 checks)",
        state: "passed",
      },
      {
        finalVerification: [
          { command: "bun run check:ast", exitCode: 0 },
          { command: "bun test src", exitCode: null },
        ],
        expected:
          "Aggregate verification incomplete (1 passed, 1 without a result)",
        state: "incomplete",
      },
      {
        finalVerification: [
          { command: "bun run check:ast", exitCode: 0 },
          { command: "bun test src", exitCode: 1 },
        ],
        expected: "Aggregate verification failed (1 of 2 checks)",
        state: "failed",
      },
    ];
    for (const item of cases) {
      const html = render([
        run({ status: "completed", tasks: [], gates: [], ...item }),
      ]);
      expect(html).toContain(item.expected);
      expect(html).toContain(`data-verification-state="${item.state}"`);
    }
  });

  test("user-accepted or waived criteria are identified separately from machine evidence", () => {
    const html = render([
      run({
        status: "completed",
        tasks: [],
        gates: [],
        finalVerification: [{ command: "bun run check:ast", exitCode: 0 }],
        decisions: [
          {
            decisionId: "dec-1",
            kind: "goal_criteria_acceptance",
            status: "answered",
            prompt: "Was the criterion met?",
            createdAt: "2026-07-11T00:01:00.000Z",
            criterionIds: ["crit-1"],
          },
        ],
      }),
    ]);
    expect(html).toContain("Aggregate verification passed (1 check)");
    expect(html).toContain("accepted or waived by your review");
    expect(html).toContain("not machine evidence");
  });

  test("attention summary lists runs needing the user", () => {
    const html = render([run()]);
    expect(html).toContain('data-testid="runs-attention-summary"');
    expect(html).toContain("needs your attention");
  });
});
