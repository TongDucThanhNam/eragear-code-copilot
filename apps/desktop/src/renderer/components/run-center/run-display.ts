import type {
  SupervisorRunClientUpdate,
  SupervisorRunDetailClientView,
  SupervisosStatusPresentation,
} from "@eragear-code-copilot/shared";
import {
  describeSupervisosRunStatus,
  describeSupervisosTaskStatus,
  describeSupervisosWaitCause,
  formatSupervisosWaitTime,
  isUserApprovableSupervisosGate,
} from "@eragear-code-copilot/shared";

/**
 * Pure display projection over the compact client update (plus the optional
 * bounded detail view). No React, no timers, no scheduling: components feed
 * `nowMs` in and render the result. Keep this the single place that decides
 * what a run "says" so the chat rail, Run Center, and workspace agree.
 */

export type RunListGroup = "attention" | "running" | "waiting" | "history";

const TERMINAL_RUN_STATUSES = new Set<SupervisorRunClientUpdate["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

export function isTerminalSupervisosRun(
  run: Pick<SupervisorRunClientUpdate, "status">
): boolean {
  return TERMINAL_RUN_STATUSES.has(run.status);
}

export function getRunDisplayTitle(run: SupervisorRunClientUpdate): string {
  const contractTitle = run.sourceGoalContract?.contract?.title.trim();
  if (contractTitle) {
    return contractTitle;
  }
  const taskTitle = run.tasks[0]?.title.trim();
  if (taskTitle) {
    return taskTitle;
  }
  const planSummary = run.plan?.summary.trim();
  if (planSummary) {
    return planSummary;
  }
  return run.status === "planning"
    ? "Manager is planning this goal"
    : "Supervised goal";
}

export function getRunGoalStatement(
  run: SupervisorRunClientUpdate,
  detail?: SupervisorRunDetailClientView | null
): string | undefined {
  const objective = run.sourceGoalContract?.contract?.objective.trim();
  if (objective) {
    return objective;
  }
  const intent = detail?.originalIntent?.trim();
  if (intent) {
    return intent;
  }
  return run.plan?.summary.trim() || undefined;
}

export interface RunProgressSummary {
  completed: number;
  failed: number;
  active: number;
  waiting: number;
  total: number;
}

export function getRunProgress(
  run: SupervisorRunClientUpdate
): RunProgressSummary {
  const summary: RunProgressSummary = {
    completed: 0,
    failed: 0,
    active: 0,
    waiting: 0,
    total: run.tasks.length,
  };
  for (const task of run.tasks) {
    switch (task.status) {
      case "completed":
        summary.completed += 1;
        break;
      case "failed":
        summary.failed += 1;
        break;
      case "cancelled":
        break;
      case "blocked":
      case "ready":
      case "queued":
      case "waiting_capacity":
        summary.waiting += 1;
        break;
      default:
        summary.active += 1;
        break;
    }
  }
  return summary;
}

export interface RunCurrentActivity {
  headline: string;
  detail?: string;
}

export type RunVerificationState = "passed" | "failed" | "incomplete" | "none";

export interface RunVerificationSummary {
  state: RunVerificationState;
  /** Checks that exited 0 — the only basis for a passing claim. */
  passed: number;
  /** Checks with a recorded non-zero exit. */
  failed: number;
  /** Checks recorded without an exit result (exitCode null). */
  pending: number;
  total: number;
  /** Goal criteria resolved by explicit user accept/waive decisions. */
  userResolvedCriteria: number;
}

/**
 * Single evidence classifier for run verification. Run outcome and
 * verification evidence are different facts: an empty check list is not a
 * pass, a null exit is not a pass or a fail, and explicit user
 * acceptance/waiver decisions are user review, never machine evidence.
 */
/** Evidence state from the counted checks; empty evidence never reads as a pass. */ function runVerificationStateOf(
  total: number,
  failed: number,
  pending: number
): RunVerificationState {
  if (total === 0) {
    return "none";
  }
  if (failed > 0) {
    return "failed";
  }
  if (pending > 0) {
    return "incomplete";
  }
  return "passed";
}

export function getRunVerificationSummary(
  run: Pick<SupervisorRunClientUpdate, "finalVerification" | "decisions">
): RunVerificationSummary {
  const total = run.finalVerification.length;
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const check of run.finalVerification) {
    if (check.exitCode === null) {
      pending += 1;
    } else if (check.exitCode === 0) {
      passed += 1;
    } else {
      failed += 1;
    }
  }
  const state = runVerificationStateOf(total, failed, pending);
  const userResolvedCriteria = run.decisions.filter(
    (decision) =>
      decision.status === "answered" &&
      decision.kind === "goal_criteria_acceptance"
  ).length;
  return { state, passed, failed, pending, total, userResolvedCriteria };
}

/** Honest completed-run wording for a verification summary. */
export function describeRunVerificationSummary(
  summary: RunVerificationSummary
): {
  label: string;
  tone: "success" | "failed" | "attention" | "neutral";
} {
  switch (summary.state) {
    case "passed":
      return {
        label: `Aggregate verification passed (${summary.passed} check${summary.passed === 1 ? "" : "s"})`,
        tone: "success",
      };
    case "failed":
      return {
        label: `Aggregate verification failed (${summary.failed} of ${summary.total} checks)`,
        tone: "failed",
      };
    case "incomplete":
      return {
        label: `Aggregate verification incomplete (${summary.passed} passed, ${summary.pending} without a result)`,
        tone: "attention",
      };
    default:
      return {
        label: "No aggregate verification recorded",
        tone: "neutral",
      };
  }
}

const COMPLETED_VERIFICATION_HEADLINE: Record<RunVerificationState, string> = {
  passed: "Completed with passing verification",
  failed: "Completed with failed verification",
  incomplete: "Completed — verification incomplete",
  none: "Completed without aggregate verification",
};

/** What is happening right now / why has it stopped / what happens next. */
export function getRunCurrentActivity(
  run: SupervisorRunClientUpdate
): RunCurrentActivity {
  const progress = getRunProgress(run);
  switch (run.status) {
    case "awaiting_approval":
      return {
        headline: "Waiting for your approval",
        detail: "Nothing runs until you approve this exact plan.",
      };
    case "planning":
      return { headline: "Manager is drafting an exact plan" };
    case "needs_user": {
      const decisions = run.decisions.filter(
        (decision) => decision.status === "open"
      ).length;
      const gates = run.gates.filter(
        (gate) =>
          gate.status === "pending" && isUserApprovableSupervisosGate(gate.kind)
      ).length;
      const parts: string[] = [];
      if (decisions > 0) {
        parts.push(`${decisions} decision${decisions === 1 ? "" : "s"}`);
      }
      if (gates > 0) {
        parts.push(`${gates} gate${gates === 1 ? "" : "s"}`);
      }
      return {
        headline: "Needs you to continue",
        detail:
          parts.length > 0 ? `Waiting on ${parts.join(" and ")}.` : undefined,
      };
    }
    case "waiting_capacity": {
      const cause = run.capacityWaits[0]
        ? describeSupervisosWaitCause(
            run.capacityWaits[0].kind
          ).label.toLowerCase()
        : "provider capacity";
      return {
        headline: `Waiting for ${cause}`,
        detail: "The run resumes on its own when capacity returns.",
      };
    }
    case "paused":
      return {
        headline: "Paused by you",
        detail: "The run stays exactly here until you resume it.",
      };
    case "completing":
      return { headline: "Final verification and integration are running" };
    case "queued":
      return { headline: "Queued for dispatch" };
    case "running": {
      const runningTask = run.tasks.find(
        (task) =>
          task.status === "running" ||
          task.status === "reviewing" ||
          task.status === "integrating"
      );
      return {
        headline:
          progress.completed > 0
            ? `${progress.completed} of ${progress.total} tasks done`
            : "Workers are executing the plan",
        detail: runningTask ? `Now: ${runningTask.title}` : undefined,
      };
    }
    case "completed": {
      const verification = getRunVerificationSummary(run);
      return {
        headline: COMPLETED_VERIFICATION_HEADLINE[verification.state],
        detail: run.finalCommitSha
          ? `Final commit ${run.finalCommitSha.slice(0, 12)}`
          : undefined,
      };
    }
    case "failed":
      return {
        headline: "Run failed",
        detail: "History keeps the evidence for inspection.",
      };
    case "cancelled":
      return { headline: "Run cancelled" };
    case "draft":
      return { headline: "Draft — planning has not started" };
    default:
      return { headline: describeSupervisosRunStatus(run.status).label };
  }
}

export type RunWaitingCause =
  | "quota"
  | "rate_limit"
  | "auth"
  | "transport"
  | "session_fatal"
  | "unknown_provider"
  | "dependency"
  | "repository"
  | "paused";

export interface RunWaitingRow {
  id: string;
  cause: RunWaitingCause;
  /** One-line reason, e.g. "Provider quota exhausted". */
  reason: string;
  /** Who/what is waiting: task title, manager, or the run itself. */
  ownerLabel: string;
  /** Waiting on a human authority rather than elapsed time. */
  waitingOnHuman: boolean;
  retryAt?: string;
  resetAt?: string;
  /** Task to navigate to, when the wait belongs to one task. */
  taskId?: string;
}

const CAPACITY_CAUSE_BY_KIND = {
  quota_exhausted: "quota",
  transient_rate_limit: "rate_limit",
  auth_required: "auth",
  transport: "transport",
  session_fatal: "session_fatal",
  unknown: "unknown_provider",
} as const satisfies Record<
  SupervisorRunClientUpdate["capacityWaits"][number]["kind"],
  RunWaitingCause
>;

/**
 * Truthful waiting rows for the current state. Terminal runs show nothing;
 * paused runs show only the paused row; capacity waits never present
 * themselves as current activity on those runs.
 */
export function getRunWaitingRows(
  run: SupervisorRunClientUpdate,
  allRuns: readonly SupervisorRunClientUpdate[]
): RunWaitingRow[] {
  if (isTerminalSupervisosRun(run)) {
    return [];
  }
  const rows: RunWaitingRow[] = [];
  if (run.status === "paused" && !run.cancellation) {
    rows.push({
      id: "paused",
      cause: "paused",
      reason: "Paused by you",
      ownerLabel: "Whole run",
      waitingOnHuman: false,
    });
  }
  for (const wait of run.capacityWaits) {
    const cause = describeSupervisosWaitCause(wait.kind);
    const task = wait.taskId
      ? run.tasks.find((candidate) => candidate.taskId === wait.taskId)
      : undefined;
    rows.push({
      id: wait.waitId,
      cause: CAPACITY_CAUSE_BY_KIND[wait.kind],
      reason: cause.label,
      ownerLabel:
        wait.owner === "manager"
          ? `Manager (${wait.agentId})`
          : `Worker for “${task?.title ?? wait.taskId ?? "task"}”`,
      waitingOnHuman: cause.waitingOnHuman,
      retryAt: wait.retryAt,
      ...(wait.resetAt ? { resetAt: wait.resetAt } : {}),
      ...(task ? { taskId: task.taskId } : {}),
    });
  }
  const completed = new Set(
    run.tasks
      .filter((task) => task.status === "completed")
      .map((task) => task.taskId)
  );
  for (const task of run.tasks) {
    if (task.status !== "blocked") {
      continue;
    }
    const unmet = task.dependencies.filter(
      (dependency) => !completed.has(dependency)
    );
    if (unmet.length === 0) {
      continue;
    }
    rows.push({
      id: `dependency:${task.taskId}`,
      cause: "dependency",
      reason: `Waiting on ${unmet.map((id) => run.tasks.find((candidate) => candidate.taskId === id)?.title ?? id).join(", ")}`,
      ownerLabel: task.title,
      waitingOnHuman: false,
      taskId: task.taskId,
    });
  }
  const blocker = findDirectRepositoryBlocker(run, allRuns);
  if (blocker) {
    rows.push({
      id: `repository:${blocker.runId}`,
      cause: "repository",
      reason: `Repository busy with “${getRunDisplayTitle(blocker)}” — one writer at a time`,
      ownerLabel: getRunDisplayTitle(run),
      waitingOnHuman: false,
    });
  }
  return rows;
}

function findDirectRepositoryBlocker(
  run: SupervisorRunClientUpdate,
  allRuns: readonly SupervisorRunClientUpdate[]
): SupervisorRunClientUpdate | undefined {
  if (
    run.status !== "queued" ||
    !run.projectId ||
    !run.tasks.some(
      (task) =>
        task.executionMode === "write" &&
        (task.status === "ready" || task.status === "queued") &&
        task.attempts.length === 0
    )
  ) {
    return undefined;
  }
  return allRuns.find(
    (candidate) =>
      candidate.runId !== run.runId &&
      candidate.projectId === run.projectId &&
      !isTerminalSupervisosRun(candidate) &&
      candidate.tasks.some(
        (task) =>
          task.executionMode === "write" &&
          task.attempts.some((attempt) =>
            ["starting", "running", "waiting_capacity"].includes(attempt.status)
          )
      )
  );
}

export type RunAttentionKind =
  | "plan_approval"
  | "decision"
  | "gate"
  | "machine_gate"
  | "cancellation"
  | "worker_chat"
  | "retry_budget";

export interface RunAttentionAction {
  id: string;
  label: string;
  emphasis: "primary" | "outline" | "ghost";
  /** Actions the user cannot take right now stay visible but disabled. */
  disabledReason?: string;
}

export interface RunAttentionItem {
  id: string;
  kind: RunAttentionKind;
  /** Who holds authority over this item. */
  authority: "user" | "machine" | "worker-chat";
  title: string;
  detail?: string;
  createdAt?: string;
  actions: RunAttentionAction[];
  decisionId?: string;
  decisionKind?: string;
  gateId?: string;
  taskId?: string;
  chatId?: string;
}

function gateAttentionItems(
  run: SupervisorRunClientUpdate,
  openGates: SupervisorRunClientUpdate["gates"]
): RunAttentionItem[] {
  return openGates.map((gate) => {
    const task = run.tasks.find(
      (candidate) => candidate.taskId === gate.taskId
    );
    if (isUserApprovableSupervisosGate(gate.kind)) {
      return {
        id: `gate:${gate.gateId}`,
        kind: "gate",
        authority: "user",
        title: `Gate: ${gate.kind.replaceAll("_", " ")}`,
        detail: `${task?.title ?? gate.taskId} is blocked until this gate is decided.`,
        gateId: gate.gateId,
        taskId: gate.taskId,
        actions: [
          { id: "approve-gate", label: "Approve", emphasis: "primary" },
          { id: "reject-gate", label: "Reject", emphasis: "outline" },
        ],
      } satisfies RunAttentionItem;
    }
    return {
      id: `gate:${gate.gateId}`,
      kind: "machine_gate",
      authority: "machine",
      title: `Machine gate: ${gate.kind.replaceAll("_", " ")}`,
      detail:
        "This gate is decided by the workflow kernel against repository evidence, not by user approval. Inspect the run logs for its reason.",
      gateId: gate.gateId,
      taskId: gate.taskId,
      actions: [],
    } satisfies RunAttentionItem;
  });
}

function decisionDetailOf(
  decision: SupervisorRunClientUpdate["decisions"][number],
  isCriterionAcceptance: boolean
): string | undefined {
  if (isCriterionAcceptance) {
    return "This criterion has no machine evidence; accepting or waiving is explicit user authority.";
  }
  if (decision.criterionIds?.length) {
    return `Criteria: ${decision.criterionIds.join(", ")}`;
  }
  return undefined;
}

/**
 * Unified Needs Attention items for one run. Distinct authorities stay
 * distinct: plan approval, durable decisions, user-approvable gates,
 * machine gates (never user-approvable), cancellation cleanup, and worker
 * prompts that live only in their chat (linked, not duplicated).
 */
export function getRunAttentionItems(
  run: SupervisorRunClientUpdate
): RunAttentionItem[] {
  if (isTerminalSupervisosRun(run)) {
    return [];
  }
  const items: RunAttentionItem[] = [];
  if (run.status === "awaiting_approval" && run.plan) {
    items.push({
      id: `plan:${run.plan.version}:${run.plan.hash.slice(0, 12)}`,
      kind: "plan_approval",
      authority: "user",
      title: "Approve the exact plan to start execution",
      detail: run.plan.summary,
      actions: [
        { id: "approve", label: "Approve plan", emphasis: "primary" },
        {
          id: "request-changes",
          label: "Request changes",
          emphasis: "outline",
        },
      ],
    });
  }
  if (run.cancellation?.status === "failed") {
    items.push({
      id: "cancellation:retry",
      kind: "cancellation",
      authority: "user",
      title: "Cancellation cleanup failed",
      detail: `${run.cancellation.pendingSessionCount} session(s) and ${run.cancellation.pendingWorkspaceCount} workspace(s) still pending. Retry cancellation.`,
      actions: [
        {
          id: "retry-cancel",
          label: "Retry cancellation",
          emphasis: "primary",
        },
      ],
    });
  }
  for (const decision of run.decisions) {
    if (decision.status !== "open") {
      continue;
    }
    const isCriterionAcceptance = decision.kind === "goal_criteria_acceptance";
    items.push({
      id: `decision:${decision.decisionId}`,
      kind: "decision",
      authority: "user",
      title: decision.prompt,
      detail: decisionDetailOf(decision, isCriterionAcceptance),
      createdAt: decision.createdAt,
      decisionId: decision.decisionId,
      decisionKind: decision.kind,
      actions: isCriterionAcceptance
        ? [
            { id: "accept", label: "Accept criterion", emphasis: "primary" },
            {
              id: "waive",
              label: "Waive with note",
              emphasis: "outline",
              disabledReason: "A review note is required to waive",
            },
          ]
        : [{ id: "answer", label: "Answer", emphasis: "primary" }],
    });
  }
  const openGates = run.gates.filter((gate) => gate.status === "pending");
  items.push(...gateAttentionItems(run, openGates));
  const openDecisionIds = new Set(
    run.decisions
      .filter((decision) => decision.status === "open")
      .map((decision) => decision.decisionId)
  );
  for (const task of run.tasks) {
    if (task.status !== "needs_user") {
      continue;
    }
    const hasGate = openGates.some((gate) => gate.taskId === task.taskId);
    const lastAttempt = task.attempts.at(-1);
    const coveredByDecision = (task.criterionIds ?? []).some((criterionId) =>
      run.decisions.some(
        (decision) =>
          decision.status === "open" &&
          decision.criterionIds?.includes(criterionId) &&
          openDecisionIds.has(decision.decisionId)
      )
    );
    if (hasGate || coveredByDecision || !lastAttempt) {
      continue;
    }
    items.push({
      id: `worker-chat:${task.taskId}`,
      kind: "worker_chat",
      authority: "worker-chat",
      title: `“${task.title}” is waiting in its worker chat`,
      detail:
        "The worker may be asking a question or requesting a permission. Permission prompts are answered in the worker chat itself.",
      taskId: task.taskId,
      chatId: lastAttempt.chatId,
      actions: [
        { id: "open-chat", label: "Open worker chat", emphasis: "outline" },
      ],
    });
  }
  for (const task of run.tasks) {
    if (
      (task.status === "failed" || task.status === "needs_user") &&
      run.limits &&
      task.attempts.length >= run.limits.maxAttemptsPerTask
    ) {
      items.push({
        id: `retry-budget:${task.taskId}`,
        kind: "retry_budget",
        authority: "user",
        title: `Attempt budget exhausted for “${task.title}”`,
        detail:
          "Retrying needs a new plan. Request a replan or cancel the run.",
        taskId: task.taskId,
        actions: [{ id: "replan", label: "Replan run", emphasis: "outline" }],
      });
    }
  }
  return items;
}

export function getRunAttentionCount(run: SupervisorRunClientUpdate): number {
  return getRunAttentionItems(run).length;
}

export function selectRunsForGroup(
  runs: readonly SupervisorRunClientUpdate[],
  group: RunListGroup
): SupervisorRunClientUpdate[] {
  return runs.filter((run) => {
    if (isTerminalSupervisosRun(run)) {
      return group === "history";
    }
    switch (group) {
      case "history":
        return false;
      case "attention":
        return (
          run.status === "needs_user" ||
          run.status === "awaiting_approval" ||
          getRunAttentionItems(run).length > 0
        );
      case "waiting":
        return (
          run.status === "waiting_capacity" ||
          run.status === "paused" ||
          run.status === "queued" ||
          run.tasks.some(
            (task) =>
              task.status === "blocked" || task.status === "waiting_capacity"
          )
        );
      case "running":
        return ["running", "planning", "completing"].includes(run.status);
      default:
        return true;
    }
  });
}

export function getRunStatusPresentation(
  run: SupervisorRunClientUpdate
): SupervisosStatusPresentation {
  if (run.cancellation && run.status !== "cancelled") {
    return run.cancellation.status === "failed"
      ? {
          kind: "cancellation_blocked",
          label: "Cancellation blocked",
          tone: "failed",
          hint: "Cleanup failed; retry cancellation to finish it.",
        }
      : {
          kind: "cancelling",
          label: "Cancelling",
          tone: "paused",
          hint: "Durable cleanup is finishing; repeating the request is safe.",
        };
  }
  return describeSupervisosRunStatus(run.status);
}

export function getTaskStatusPresentation(
  task: SupervisorRunClientUpdate["tasks"][number]
) {
  return describeSupervisosTaskStatus(task.status);
}

export interface WaitTimeView {
  retry?: { text: string; valid: boolean; overdue: boolean };
  reset?: { text: string; valid: boolean; overdue: boolean };
}

export function getWaitTimeView(
  row: RunWaitingRow,
  nowMs: number
): WaitTimeView {
  return {
    ...(row.retryAt
      ? { retry: formatSupervisosWaitTime(row.retryAt, nowMs) }
      : {}),
    ...(row.resetAt
      ? { reset: formatSupervisosWaitTime(row.resetAt, nowMs) }
      : {}),
  };
}
