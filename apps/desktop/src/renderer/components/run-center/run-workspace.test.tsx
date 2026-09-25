import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunCenter } from "./run-center";
import { RunWorkspace, type RunWorkspaceActions } from "./run-workspace";
import {
  createAttemptFixture,
  createDetailAttemptFixture,
  createDetailFixture,
  createDetailTaskFixture,
  createPlanFixture,
  createRunFixture,
  createTaskFixture,
} from "./test-fixtures";

const resolved = () => Promise.resolve();

const actions: RunWorkspaceActions = {
  isPending: false,
  pause: resolved,
  resume: resolved,
  cancel: resolved,
  replan: resolved,
  retryTask: resolved,
  approvePlan: resolved,
  requestPlanChanges: resolved,
  answerDecision: resolved,
  approveGate: resolved,
  rejectGate: resolved,
  setPriority: resolved,
};

function activeRun() {
  return createRunFixture({
    tasks: [
      createTaskFixture({
        taskId: "task-a",
        title: "Implement feature",
        status: "running",
        attempts: [
          createAttemptFixture({ attemptId: "attempt-1", chatId: "chat-a" }),
        ],
      }),
      createTaskFixture({
        taskId: "task-b",
        title: "Write tests",
        status: "blocked",
        dependencies: ["task-a"],
      }),
    ],
  });
}

function richDetail() {
  return createDetailFixture({
    revision: 3,
    tasks: [
      createDetailTaskFixture({
        taskId: "task-a",
        attempts: [
          createDetailAttemptFixture({
            attemptId: "attempt-1",
            status: "running",
            checkpoint: { sha256: "a".repeat(64), byteLength: 2048 },
            files: {
              touched: { paths: ["src/a.ts", "src/b.ts"], total: 2 },
              created: { paths: ["src/c.ts"], total: 1 },
              deleted: { paths: [], total: 0 },
              renamed: [{ from: "old.ts", to: "new.ts" }],
            },
            verification: [
              {
                command: "bun test src",
                exitCode: 0,
                outputSummary: "12 pass",
              },
            ],
          }),
        ],
      }),
    ],
    finalVerification: [{ command: "bun run build", exitCode: null }],
    audit: {
      entries: [
        {
          auditId: "a-1",
          kind: "run_started",
          createdAt: "2026-09-21T10:00:00.000Z",
          actor: "user",
          summary: "Run started",
        },
      ],
      total: 41,
      truncated: true,
    },
  });
}

describe("RunWorkspace", () => {
  test("exposes all six views without dead tabs", () => {
    const run = activeRun();
    const html = renderToStaticMarkup(
      <RunWorkspace
        actions={actions}
        allRuns={[run]}
        detail={null}
        detailError={null}
        detailLoading={false}
        detailStale={false}
        onBack={() => undefined}
        onOpenWorkerChat={() => undefined}
        run={run}
      />
    );
    for (const label of [
      "Overview",
      "Workflow",
      "Tasks",
      "Changes",
      "Evidence",
      "Logs",
    ]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain('data-testid="run-workspace"');
  });

  test("overview shows goal, attention with authorities, and waiting rows", () => {
    const run = activeRun();
    const withGate = createRunFixture({
      status: "running",
      gates: [
        {
          gateId: "gate-1",
          taskId: "task-a",
          attemptId: "attempt-1",
          kind: "deletion",
          status: "pending",
        },
        {
          gateId: "gate-2",
          taskId: "task-a",
          attemptId: "attempt-1",
          kind: "verification",
          status: "pending",
        },
      ],
      capacityWaits: [
        {
          waitId: "wait-1",
          owner: "task",
          taskId: "task-a",
          attemptId: "attempt-1",
          agentId: "worker-a",
          kind: "quota_exhausted",
          retryAt: "2026-09-21T11:30:00.000Z",
          resetAt: "2026-09-21T12:00:00.000Z",
        },
      ],
      tasks: run.tasks,
    });
    const html = renderToStaticMarkup(
      <RunWorkspace
        actions={actions}
        allRuns={[withGate]}
        detail={null}
        detailError={null}
        detailLoading={false}
        detailStale={false}
        onBack={() => undefined}
        onOpenWorkerChat={() => undefined}
        run={withGate}
      />
    );
    expect(html).toContain("Your approval");
    expect(html).toContain("Machine");
    expect(html).toContain("Decided by the workflow kernel");
    expect(html).toContain("Quota");
    expect(html).toContain("Waiting on");
  });

  test("tasks view renders attempts with transcripts and truthful not-started placeholders", () => {
    const run = activeRun();
    const html = renderToStaticMarkup(
      <RunWorkspace
        actions={actions}
        allRuns={[run]}
        detail={richDetail()}
        detailError={null}
        detailLoading={false}
        detailStale={false}
        initialTab="tasks"
        onBack={() => undefined}
        onOpenWorkerChat={() => undefined}
        run={run}
      />
    );
    expect(html.split('data-testid="workspace-task"').length - 1).toBe(2);
    expect(html).toContain("Open worker chat for attempt 1");
    expect(html).toContain('data-testid="attempt-not-started"');
    expect(html).toContain("no worker has been dispatched");
  });

  test("changes view lists real paths and honest empty states", () => {
    const run = activeRun();
    const withDetail = renderToStaticMarkup(
      <RunWorkspace
        actions={actions}
        allRuns={[run]}
        detail={richDetail()}
        detailError={null}
        detailLoading={false}
        detailStale={false}
        initialTab="changes"
        onBack={() => undefined}
        onOpenWorkerChat={() => undefined}
        run={run}
      />
    );
    expect(withDetail).toContain("src/a.ts");
    expect(withDetail).toContain("old.ts → new.ts");
    expect(withDetail).toContain("checkpoint");
    const emptyRun = createRunFixture({
      tasks: [createTaskFixture({ taskId: "task-e", status: "ready" })],
    });
    const withoutDetail = renderToStaticMarkup(
      <RunWorkspace
        actions={actions}
        allRuns={[emptyRun]}
        detail={null}
        detailError={null}
        detailLoading={false}
        detailStale={false}
        initialTab="changes"
        onBack={() => undefined}
        onOpenWorkerChat={() => undefined}
        run={emptyRun}
      />
    );
    expect(withoutDetail).toContain("No worker has run yet");
  });

  test("evidence view flags uncertainty and reports missing evidence honestly", () => {
    const run = createRunFixture({
      tasks: [
        createTaskFixture({
          taskId: "task-u",
          title: "Uncertain task",
          status: "running",
          attempts: [
            createAttemptFixture({
              attemptId: "att-u",
              chatId: "",
              status: "interrupted",
            }),
          ],
        }),
        createTaskFixture({
          taskId: "task-n",
          title: "Untouched task",
          status: "ready",
        }),
      ],
    });
    const detail = createDetailFixture({
      tasks: [
        createDetailTaskFixture({
          taskId: "task-u",
          attempts: [
            createDetailAttemptFixture({
              attemptId: "att-u",
              chatId: "",
              status: "uncertain",
              unresolvedPermissions: ["fs.write:/etc"],
            }),
          ],
        }),
      ],
    });
    const html = renderToStaticMarkup(
      <RunWorkspace
        actions={actions}
        allRuns={[run]}
        detail={detail}
        detailError={null}
        detailLoading={false}
        detailStale={false}
        initialTab="evidence"
        onBack={() => undefined}
        onOpenWorkerChat={() => undefined}
        run={run}
      />
    );
    expect(html).toContain("Uncertain outcome");
    expect(html).toContain("Unresolved permissions: fs.write:/etc");
    expect(html).toContain('data-testid="evidence-not-started"');
    expect(html).toContain("no attempt evidence exists yet");
    expect(html).toContain("transcript unavailable");
  });

  test("logs view renders audit entries and honest truncation", () => {
    const run = activeRun();
    const html = renderToStaticMarkup(
      <RunWorkspace
        actions={actions}
        allRuns={[run]}
        detail={richDetail()}
        detailError={null}
        detailLoading={false}
        detailStale={false}
        initialTab="logs"
        onBack={() => undefined}
        onOpenWorkerChat={() => undefined}
        run={run}
      />
    );
    expect(html).toContain('data-testid="run-logs-truncated"');
    expect(html).toContain("latest 1 of 41 audit entries");
    expect(html).toContain("Run started");
  });

  test("workflow view renders timeline plus spine with a station inspector", () => {
    const run = activeRun();
    const html = renderToStaticMarkup(
      <RunWorkspace
        actions={actions}
        allRuns={[run]}
        detail={richDetail()}
        detailError={null}
        detailLoading={false}
        detailStale={false}
        initialTab="workflow"
        onBack={() => undefined}
        onOpenWorkerChat={() => undefined}
        run={run}
      />
    );
    expect(html).toContain('data-testid="supervisor-workflow-timeline"');
    expect(html).toContain('data-testid="lifecycle-spine"');
    expect(html).toContain("Select a station to inspect");
  });

  test("stale deep evidence says so instead of overwriting live status", () => {
    const run = activeRun();
    const staleDetail = richDetail();
    staleDetail.revision = 1;
    const html = renderToStaticMarkup(
      <RunWorkspace
        actions={actions}
        allRuns={[run]}
        detail={staleDetail}
        detailError={null}
        detailLoading={false}
        detailStale
        onBack={() => undefined}
        onOpenWorkerChat={() => undefined}
        run={run}
      />
    );
    expect(html).toContain('data-testid="run-detail-stale"');
    expect(html).toContain("stays authoritative");
  });
});

describe("RunCenter", () => {
  test("groups runs and lists attention, waiting, and history separately", () => {
    const attentionRun = createRunFixture({
      runId: "run-att",
      status: "awaiting_approval",
      plan: createPlanFixture({ summary: "Plan summary" }),
    });
    const waitingRun = createRunFixture({
      runId: "run-wait",
      status: "waiting_capacity",
      capacityWaits: [
        {
          waitId: "w1",
          owner: "manager",
          agentId: "m",
          kind: "quota_exhausted",
          retryAt: "2026-09-21T11:30:00.000Z",
        },
      ],
    });
    const doneRun = createRunFixture({
      runId: "run-done",
      status: "completed",
    });
    const html = renderToStaticMarkup(
      <RunCenter
        actions={actions}
        detail={null}
        detailError={null}
        detailLoading={false}
        detailStale={false}
        error={null}
        isLoading={false}
        onOpenWorkerChat={() => undefined}
        onSelectRun={() => undefined}
        runs={[attentionRun, waitingRun, doneRun]}
        selectedRunId={null}
      />
    );
    expect(html).toContain("Attention");
    expect(html).toContain("Running");
    expect(html).toContain("Waiting");
    expect(html).toContain("History");
    // Default group is attention: only the approval run is listed.
    expect(html).toContain("Select a run");
    expect(html.split('data-testid="run-center-item"').length - 1).toBe(1);
    expect(html).toContain("1 need attention");
  });

  test("renders the workspace for the selected run", () => {
    const run = activeRun();
    const html = renderToStaticMarkup(
      <RunCenter
        actions={actions}
        detail={null}
        detailError={null}
        detailLoading={false}
        detailStale={false}
        error={null}
        isLoading={false}
        onOpenWorkerChat={() => undefined}
        onSelectRun={() => undefined}
        runs={[run]}
        selectedRunId={run.runId}
      />
    );
    expect(html).toContain('data-testid="run-workspace"');
    expect(html).toContain("Implement feature");
  });

  test("empty attention group says nothing needs the user", () => {
    const html = renderToStaticMarkup(
      <RunCenter
        actions={actions}
        detail={null}
        detailError={null}
        detailLoading={false}
        detailStale={false}
        error={null}
        isLoading={false}
        onOpenWorkerChat={() => undefined}
        onSelectRun={() => undefined}
        runs={[]}
        selectedRunId={null}
      />
    );
    expect(html).toContain("Nothing needs your attention right now.");
  });
});
