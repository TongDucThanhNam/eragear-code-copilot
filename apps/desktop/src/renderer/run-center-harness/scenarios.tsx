import type {
  SupervisorRunClientUpdate,
  SupervisorRunDetailClientView,
} from "@eragear-code-copilot/shared";
import { SupervisosRunsView } from "@/components/chat-ui/supervisos-runs";
import { RunCenter } from "@/components/run-center/run-center";
import type { RunWorkspaceActions } from "@/components/run-center/run-workspace";
import { RunWorkspace } from "@/components/run-center/run-workspace";
import {
  createAttemptFixture,
  createDetailAttemptFixture,
  createDetailFixture,
  createDetailTaskFixture,
  createPlanFixture,
  createRunFixture,
  createTaskFixture,
} from "@/components/run-center/test-fixtures";
import type { useSupervisorRunsCore } from "@/hooks/use-supervisor-runs";

type RunsController = ReturnType<typeof useSupervisorRunsCore>;

// Fixture evidence only: every scenario below is synthetic. No ACP session,
// no provider call, and no billable agent is started by this harness.

const RETRY_AT = "2026-09-22T18:30:00.000Z";
const RESET_AT = "2026-09-22T19:00:00.000Z";
const NOW_BASE = "2026-09-22T11:00:00.000Z";

const resolved = () => Promise.resolve();

export const workspaceActions: RunWorkspaceActions = {
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

/** Branched DAG with a retry, a pending user gate, a machine gate, and a quota wait. */
export function branchyRun(): SupervisorRunClientUpdate {
  return createRunFixture({
    runId: "run-branch",
    revision: 7,
    status: "running",
    originatingChatId: "chat-main",
    createdAt: NOW_BASE,
    updatedAt: "2026-09-22T11:40:00.000Z",
    manager: {
      agentId: "manager-1",
      chatId: "chat-manager",
      status: "running",
      exactResumeRequired: true,
    },
    plan: createPlanFixture({
      version: 2,
      summary:
        "Map the repository, implement and test in parallel branches, integrate with verification",
    }),
    tasks: [
      createTaskFixture({
        taskId: "task-a",
        title: "Map repository structure",
        status: "completed",
        attempts: [
          createAttemptFixture({
            attemptId: "att-a1",
            chatId: "chat-scout",
            agentId: "scout-a",
            status: "terminal",
          }),
        ],
      }),
      createTaskFixture({
        taskId: "task-b",
        title: "Implement the export pipeline behind ERAGEAR_EXPORT=1",
        status: "running",
        dependencies: ["task-a"],
        preferredModelId: "zai-individual-coding-plan/GLM-5.3-Flash",
        attempts: [
          createAttemptFixture({
            attemptId: "att-b1",
            chatId: "",
            agentId: "worker-b1-implementer",
            status: "interrupted",
          }),
          createAttemptFixture({
            attemptId: "att-b2",
            chatId: "chat-worker-b2",
            agentId: "worker-b2-implementer",
            status: "running",
          }),
        ],
      }),
      createTaskFixture({
        taskId: "task-c",
        title: "Write regression tests",
        status: "blocked",
        dependencies: ["task-a"],
      }),
      createTaskFixture({
        taskId: "task-d",
        title: "Integrate and verify",
        status: "queued",
        dependencies: ["task-b", "task-c"],
      }),
    ],
    gates: [
      {
        gateId: "gate-1",
        taskId: "task-b",
        attemptId: "att-b2",
        kind: "deletion",
        status: "pending",
      },
      {
        gateId: "gate-2",
        taskId: "task-a",
        attemptId: "att-a1",
        kind: "baseline_drift",
        status: "pending",
      },
    ],
    capacityWaits: [
      {
        waitId: "wait-1",
        owner: "task",
        taskId: "task-b",
        attemptId: "att-b2",
        agentId: "worker-b2",
        kind: "quota_exhausted",
        retryAt: RETRY_AT,
        resetAt: RESET_AT,
      },
    ],
    decisions: [
      {
        decisionId: "dec-1",
        kind: "goal_criteria_acceptance",
        status: "open",
        prompt:
          "Criterion “tests pass” cannot be verified while the worker is interrupted. Accept after your own review, or waive with a note?",
        createdAt: "2026-09-22T11:20:00.000Z",
        criterionIds: ["crit-1"],
      },
    ],
  });
}

/** Deep projection matching branchyRun: uncertainty, file evidence, truncated audit. */
export function branchyDetail(): SupervisorRunDetailClientView {
  return createDetailFixture({
    runId: "run-branch",
    revision: 7,
    status: "running",
    phase: "executing",
    desiredState: "running",
    originalIntent:
      "Add an export pipeline behind a flag, with tests and docs, delivered on a branch",
    createdAt: NOW_BASE,
    updatedAt: "2026-09-22T11:40:00.000Z",
    tasks: [
      createDetailTaskFixture({
        taskId: "task-a",
        title: "Map repository structure",
        prompt: "List the modules that own export behavior today.",
        filesAllowed: { paths: ["docs/structure.md"], total: 12 },
        verificationCommands: ["bun run check:ast"],
        status: "completed",
        attempts: [
          createDetailAttemptFixture({
            attemptId: "att-a1",
            chatId: "chat-scout",
            agentId: "scout-a",
            status: "terminal",
            outcomeSummary:
              "Mapped 6 modules; export ownership sits in runtime.",
            verification: [
              {
                command: "bun run check:ast",
                exitCode: 0,
                outputSummary: "ok",
              },
            ],
          }),
        ],
      }),
      createDetailTaskFixture({
        taskId: "task-b",
        title: "Implement feature",
        prompt: "Implement the export pipeline behind ERAGEAR_EXPORT=1.",
        dependencies: ["task-a"],
        filesAllowed: {
          paths: ["src/export/pipeline.ts", "src/export/cli.ts"],
          total: 5,
        },
        verificationCommands: ["bun test src/export"],
        status: "running",
        attempts: [
          createDetailAttemptFixture({
            attemptId: "att-b1",
            chatId: "",
            agentId: "worker-b1",
            status: "uncertain",
            outcomeSummary: "Wrote three files; then the transport dropped.",
            reason: "Worker lost mid-write; effect uncertain",
            checkpoint: { sha256: "b".repeat(64), byteLength: 9216 },
            files: {
              touched: {
                paths: ["src/export/pipeline.ts", "src/cli.ts"],
                total: 2,
              },
              created: { paths: ["src/export/pipeline.ts"], total: 1 },
              deleted: { paths: ["src/legacy-export.ts"], total: 1 },
              renamed: [{ from: "src/old-name.ts", to: "src/new-name.ts" }],
            },
            verification: [{ command: "bun test src/export", exitCode: null }],
            unresolvedPermissions: ["fs.write:.eragear/checkpoints"],
            toolFailureSummary: ["write_file timed out after 30s"],
          }),
          createDetailAttemptFixture({
            attemptId: "att-b2",
            chatId: "chat-worker-b2",
            agentId: "worker-b2",
            status: "running",
          }),
        ],
      }),
      createDetailTaskFixture({
        taskId: "task-c",
        title: "Write regression tests",
        prompt: "Cover the flag-off path so the default build is unchanged.",
        dependencies: ["task-a"],
        status: "blocked",
        attempts: [],
      }),
    ],
    finalVerification: [{ command: "bun run check-types", exitCode: null }],
    audit: {
      entries: [
        {
          auditId: "a-3",
          kind: "capacity_wait_recorded",
          createdAt: "2026-09-22T11:38:00.000Z",
          actor: "orchestrator",
          summary: "Quota exhausted for worker-b2; retry scheduled.",
        },
        {
          auditId: "a-2",
          kind: "gate_opened",
          createdAt: "2026-09-22T11:30:00.000Z",
          actor: "orchestrator",
          summary: "Deletion gate opened for task-b attempt 2.",
        },
        {
          auditId: "a-1",
          kind: "run_started",
          createdAt: "2026-09-22T11:00:00.000Z",
          actor: "user",
          summary: "Run started from chat intent.",
        },
      ],
      total: 41,
      truncated: true,
    },
  });
}

export function attentionRun(): SupervisorRunClientUpdate {
  return createRunFixture({
    runId: "run-approve",
    revision: 4,
    status: "awaiting_approval",
    originatingChatId: "chat-main",
    plan: createPlanFixture({
      summary: "Refactor the settings loader into a runtime service",
    }),
    tasks: [
      createTaskFixture({
        taskId: "task-s1",
        title: "Move the settings loader into the runtime service",
        status: "queued",
        preferredModelId: "zai-individual-coding-plan/GLM-5.3-Flash",
      }),
    ],
  });
}

export function waitingRun(): SupervisorRunClientUpdate {
  return createRunFixture({
    runId: "run-quota",
    revision: 9,
    status: "waiting_capacity",
    originatingChatId: "chat-other",
    capacityWaits: [
      {
        waitId: "w-manager",
        owner: "manager",
        agentId: "manager-9",
        kind: "quota_exhausted",
        retryAt: RETRY_AT,
        resetAt: RESET_AT,
      },
    ],
  });
}

export function doneRun(): SupervisorRunClientUpdate {
  return createRunFixture({
    runId: "run-done",
    revision: 12,
    status: "completed",
    originatingChatId: "chat-main",
    finalCommitSha: "60239e14",
    decisions: [
      {
        decisionId: "dec-done",
        kind: "goal_criteria_acceptance",
        status: "answered",
        prompt: "Criterion “docs updated” accepted after user review.",
        createdAt: "2026-09-22T11:50:00.000Z",
        answeredAt: "2026-09-22T11:55:00.000Z",
        criterionIds: ["crit-docs"],
      },
    ],
  });
}

function chatControllerStub(
  runs: SupervisorRunClientUpdate[]
): Omit<RunsController, "updateCachedRun"> {
  const resolvedRun = () => {
    const first = runs[0];
    if (!first) {
      throw new Error("Chat controller stub needs at least one fixture run");
    }
    return Promise.resolve(first);
  };
  return {
    runs,
    isLoading: false,
    error: null,
    isPending: false,
    canStart: true,
    start: resolvedRun,
    approvePlan: resolvedRun,
    requestPlanChanges: resolvedRun,
    answerDecision: resolvedRun,
    setPriority: resolvedRun,
    pause: resolvedRun,
    resume: resolvedRun,
    cancel: resolvedRun,
    replan: resolvedRun,
    retryTask: resolvedRun,
    approveGate: resolvedRun,
    rejectGate: resolvedRun,
  };
}

export function HarnessApp({ scene, view }: { scene: string; view: string }) {
  const branchy = branchyRun();
  const runs = [branchy, attentionRun(), waitingRun(), doneRun()];
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <div className="flex h-8 shrink-0 items-center justify-center border-amber-500/40 border-b bg-amber-500/10 font-medium text-[11px] text-amber-600 uppercase tracking-wide dark:text-amber-400">
        Fixture evidence — synthetic data, no live agents or runs
      </div>
      <div className="min-h-0 flex-1">
        <HarnessScene branchy={branchy} runs={runs} scene={scene} view={view} />
      </div>
    </div>
  );
}

function HarnessScene({
  branchy,
  runs,
  scene,
  view,
}: {
  branchy: SupervisorRunClientUpdate;
  runs: SupervisorRunClientUpdate[];
  scene: string;
  view: string;
}) {
  if (scene === "center") {
    return (
      <RunCenter
        actions={workspaceActions}
        detail={branchyDetail()}
        detailError={null}
        detailLoading={false}
        detailStale={false}
        error={null}
        initialGroup="running"
        isLoading={false}
        onOpenWorkerChat={() => undefined}
        onSelectRun={() => undefined}
        runs={runs}
        selectedRunId={branchy.runId}
      />
    );
  }
  if (scene === "chat") {
    return (
      <div
        className="mx-auto h-full w-full max-w-xl overflow-y-auto border-x bg-background"
        data-testid="chat-narrow-root"
      >
        <SupervisosRunsView
          {...chatControllerStub(runs)}
          chatId="chat-main"
          onOpenWorker={() => undefined}
        />
      </div>
    );
  }
  return (
    <RunWorkspace
      actions={workspaceActions}
      allRuns={runs}
      detail={branchyDetail()}
      detailError={null}
      detailLoading={false}
      detailStale={false}
      initialTab={view}
      onBack={() => undefined}
      onOpenWorkerChat={() => undefined}
      run={branchy}
    />
  );
}
