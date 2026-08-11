import { describe, expect, test } from "bun:test";
import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getRunStatusTone,
  isApprovableGate,
  SupervisosRunsView,
} from "./supervisos-runs";

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
      onOpenWorker: () => undefined,
    })
  );
}

describe("SupervisosRunsView", () => {
  test("renders an intentional empty state and loading recovery state", () => {
    expect(render([])).toContain("No supervised run yet");
    expect(render([], true)).toContain("Loading runs");
  });

  test("renders dependency status, worker links, evidence gates, and controls", () => {
    const html = render([run()]);
    expect(html).toContain("Implement scoped change");
    expect(html).toContain("waits for 1");
    expect(html).toContain("worker-chat-1");
    expect(html).toContain("Gate: scope");
    expect(html).toContain("Approve");
    expect(html).toContain("Retry");
    expect(html).toContain("Replan");
    expect(html).toContain("Cancel");
  });

  test("renders completed aggregate verification and deterministic gate policy", () => {
    const html = render([
      run({ status: "completed", tasks: [], gates: [], finalVerification: [] }),
    ]);
    expect(html).toContain("Aggregate verification complete");
    expect(getRunStatusTone("completed")).toEqual({
      label: "Completed",
      variant: "secondary",
    });
    expect(isApprovableGate("deletion")).toBe(true);
    expect(isApprovableGate("baseline_drift")).toBe(false);
  });
});
