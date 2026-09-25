import type {
  SupervisorRunClientUpdate,
  SupervisosStatusPresentation,
} from "@eragear-code-copilot/shared";
import {
  describeSupervisosAttemptInContext,
  describeSupervisosRunStatus,
  describeSupervisosTaskStatus,
  supervisosAgentIdentityIndex,
} from "@eragear-code-copilot/shared";

/**
 * Pure display model for the Supervisos workflow timeline and lifecycle
 * spine. One model, two consumers (horizontal timeline + vertical spine),
 * mirroring "one projection, several readers". No React, no DOM, no time.
 *
 * Honesty rules encoded here:
 * - Only real task dependencies produce links; independent tasks never get
 *   invented arrows. The rail itself is the lifecycle order, not a claim of
 *   causality.
 * - Lifecycle stations (review, integration, verification, delivery) appear
 *   only with evidence-backed states; otherwise they render as upcoming
 *   (`planned`) rather than guessed complete.
 * - Cyclic or missing dependency data degrades to input order without links
 *   instead of crashing or fabricating a graph.
 */

export type RunTimelineStationKind =
  | "plan"
  | "task"
  | "review"
  | "integration"
  | "verification"
  | "delivery";

export interface RunTimelinePill {
  key: string;
  label: string;
  kind: "manager" | "worker";
  /** Stable identity seed; the hue derives from it and never from status. */
  identitySeed: string;
  status: SupervisosStatusPresentation;
  /** Present only when a real chat binding exists. */
  chatId?: string;
  taskId?: string;
  attemptIndex?: number;
  attemptId?: string;
}

export interface RunTimelineStation {
  id: string;
  label: string;
  kind: RunTimelineStationKind;
  status: SupervisosStatusPresentation;
  /** Attempt count for tasks; >1 renders a retry marker. */
  rounds: number;
  /** Evidence-backed detail line, e.g. "2/3 checks passed". */
  detail?: string;
  pills: RunTimelinePill[];
  taskId?: string;
  selectable: boolean;
}

export interface RunTimelineLink {
  /** Station indexes. */
  from: number;
  to: number;
  kind: "dependency";
}

export interface RunTimelineModel {
  stations: RunTimelineStation[];
  links: RunTimelineLink[];
  /** Set when dependency data was unusable and the fallback order is shown. */
  degraded: null | "cyclic" | "missing_dependency";
}

function managerStatusOf(
  run: SupervisorRunClientUpdate
): SupervisosStatusPresentation {
  const manager = run.manager;
  if (!manager) {
    return describeSupervisosRunStatus("draft");
  }
  switch (manager.status) {
    case "running":
      return describeSupervisosRunStatus("running");
    case "waiting_capacity":
      return describeSupervisosRunStatus("waiting_capacity");
    case "creating":
      return { kind: "starting", label: "Starting", tone: "progress" };
    case "failed":
      return describeSupervisosRunStatus("failed");
    case "stopped":
      return describeSupervisosRunStatus("paused");
    default:
      return describeSupervisosRunStatus("draft");
  }
}

type TaskOutcome = "succeeded" | "failed" | "cancelled" | undefined;

function taskOutcomeOf(
  task: SupervisorRunClientUpdate["tasks"][number]
): TaskOutcome {
  if (task.status === "completed") {
    return "succeeded";
  }
  if (task.status === "failed") {
    return "failed";
  }
  if (task.status === "cancelled") {
    return "cancelled";
  }
  return undefined;
}

function planStation(run: SupervisorRunClientUpdate): RunTimelineStation {
  let status: SupervisosStatusPresentation;
  let detail: string | undefined;
  const planApproved = Boolean(run.plan?.approvedAt);
  const tasksExist = run.tasks.length > 0;
  if (run.status === "awaiting_approval" && run.plan) {
    status = describeSupervisosRunStatus("awaiting_approval");
    detail = `Plan v${run.plan.version} awaiting approval`;
  } else if (run.status === "planning") {
    status = describeSupervisosRunStatus("planning");
    detail = "Drafting the exact plan";
  } else if (planApproved || (tasksExist && run.status !== "draft")) {
    status = describeSupervisosRunStatus("completed");
    detail = run.plan ? `Plan v${run.plan.version} approved` : undefined;
  } else if (run.status === "waiting_capacity" && !tasksExist) {
    status = describeSupervisosRunStatus("waiting_capacity");
  } else {
    status = describeSupervisosRunStatus("draft");
  }
  const pills: RunTimelinePill[] = [];
  if (run.manager) {
    pills.push({
      key: "manager",
      label: "Manager",
      kind: "manager",
      identitySeed: run.manager.agentId,
      status: managerStatusOf(run),
      chatId: run.manager.chatId,
    });
  }
  return {
    id: "station:plan",
    label: "Plan",
    kind: "plan",
    status,
    rounds: 1 + (run.plan ? Math.max(0, run.plan.version - 1) : 0),
    ...(detail ? { detail } : {}),
    pills,
    selectable: true,
  };
}

function taskStations(run: SupervisorRunClientUpdate): {
  stations: RunTimelineStation[];
  order: string[];
  degraded: RunTimelineModel["degraded"];
} {
  const tasks = run.tasks;
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const knownIds = new Set(byId.keys());
  let degraded: RunTimelineModel["degraded"] = null;
  const hasMissing = tasks.some((task) =>
    task.dependencies.some((dependency) => !knownIds.has(dependency))
  );
  if (hasMissing) {
    degraded = "missing_dependency";
  }
  // Kahn topological order, stable by input order. On a cycle, fall back to
  // input order and drop dependency links entirely.
  const inDegree = new Map(tasks.map((task) => [task.taskId, 0]));
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!knownIds.has(dependency) || dependency === task.taskId) {
        continue;
      }
      inDegree.set(task.taskId, (inDegree.get(task.taskId) ?? 0) + 1);
      dependents.set(dependency, [
        ...(dependents.get(dependency) ?? []),
        task.taskId,
      ]);
    }
  }
  const order: string[] = [];
  const queue = tasks
    .filter((task) => (inDegree.get(task.taskId) ?? 0) === 0)
    .map((task) => task.taskId);
  const remaining = new Map(inDegree);
  while (queue.length > 0) {
    const taskId = queue.shift();
    if (taskId === undefined) {
      break;
    }
    order.push(taskId);
    for (const dependent of dependents.get(taskId) ?? []) {
      const next = (remaining.get(dependent) ?? 0) - 1;
      remaining.set(dependent, next);
      if (next === 0) {
        queue.push(dependent);
      }
    }
  }
  let finalOrder = order;
  if (finalOrder.length !== tasks.length) {
    degraded = "cyclic";
    finalOrder = tasks.map((task) => task.taskId);
  }
  const stations = finalOrder.map((taskId) => {
    const task = byId.get(taskId);
    if (!task) {
      throw new Error(`Timeline model lost task ${taskId}`);
    }
    const status = describeSupervisosTaskStatus(task.status);
    const unmet = task.dependencies.filter((dependency) => {
      const dependencyTask = byId.get(dependency);
      return dependencyTask && dependencyTask.status !== "completed";
    });
    const detail =
      task.status === "blocked" && unmet.length > 0
        ? `Waiting on ${unmet
            .map((id) => byId.get(id)?.title ?? id)
            .map((title) => `“${title}”`)
            .join(", ")}`
        : undefined;
    const pills: RunTimelinePill[] = task.attempts.map((attempt, index) => ({
      key: attempt.attemptId,
      label: attempt.agentId,
      kind: "worker",
      identitySeed: attempt.agentId || attempt.attemptId,
      status: describeSupervisosAttemptInContext({
        status: attempt.status,
        hasLaterAttempt:
          index < task.attempts.length - 1 && task.status === "completed",
        taskOutcome: taskOutcomeOf(task),
      }),
      chatId: attempt.chatId,
      taskId: task.taskId,
      attemptIndex: index,
      attemptId: attempt.attemptId,
    }));
    return {
      id: `station:task:${task.taskId}`,
      label: task.title,
      kind: "task" as const,
      status,
      rounds: task.attempts.length,
      ...(detail ? { detail } : {}),
      pills,
      taskId: task.taskId,
      selectable: true,
    };
  });
  return { stations, order: finalOrder, degraded };
}

function lifecycleStations(
  run: SupervisorRunClientUpdate
): RunTimelineStation[] {
  const stations: RunTimelineStation[] = [];
  const anyReviewing = run.tasks.some((task) => task.status === "reviewing");
  const anyIntegrating = run.tasks.some(
    (task) => task.status === "integrating"
  );
  const anyGate = run.gates.length > 0;
  const terminal = ["completed", "failed", "cancelled"].includes(run.status);

  let reviewStatus = describeSupervisosRunStatus("draft");
  if (anyReviewing || (anyGate && !terminal)) {
    reviewStatus = describeSupervisosRunStatus("running");
  } else if (terminal || run.status === "completing") {
    reviewStatus = describeSupervisosRunStatus("completed");
  }
  stations.push({
    id: "station:review",
    label: "Review",
    kind: "review",
    status: reviewStatus,
    rounds: 1,
    ...(anyGate
      ? {
          detail: `${run.gates.filter((gate) => gate.status === "pending").length} gate(s) recorded`,
        }
      : {}),
    pills: [],
    selectable: true,
  });

  let integrationStatus = describeSupervisosRunStatus("draft");
  let integrationDetail: string | undefined;
  if (anyIntegrating) {
    integrationStatus = describeSupervisosRunStatus("running");
  } else if (run.finalCommitSha) {
    integrationStatus = describeSupervisosRunStatus("completed");
    integrationDetail = `Integrated ${run.finalCommitSha.slice(0, 12)}`;
  }
  stations.push({
    id: "station:integration",
    label: "Integration",
    kind: "integration",
    status: integrationStatus,
    rounds: 1,
    ...(integrationDetail ? { detail: integrationDetail } : {}),
    pills: [],
    selectable: true,
  });

  let verificationStatus = describeSupervisosRunStatus("draft");
  let verificationDetail: string | undefined;
  const finalChecks = run.finalVerification;
  if (run.status === "completing") {
    verificationStatus = describeSupervisosRunStatus("running");
  } else if (run.status === "completed") {
    verificationStatus = describeSupervisosRunStatus("completed");
    verificationDetail =
      finalChecks.length > 0
        ? `${finalChecks.filter((check) => check.exitCode === 0).length}/${finalChecks.length} checks passed`
        : "Completed with accepted evidence";
  } else if (
    run.status === "failed" &&
    finalChecks.some((check) => check.exitCode !== 0)
  ) {
    verificationStatus = describeSupervisosRunStatus("failed");
  } else if (finalChecks.length > 0) {
    verificationStatus = describeSupervisosRunStatus("running");
  }
  stations.push({
    id: "station:verification",
    label: "Verify",
    kind: "verification",
    status: verificationStatus,
    rounds: 1,
    ...(verificationDetail ? { detail: verificationDetail } : {}),
    pills: [],
    selectable: true,
  });

  let deliveryStatus = describeSupervisosRunStatus("draft");
  let deliveryDetail: string | undefined;
  if (run.status === "completed") {
    deliveryStatus = describeSupervisosRunStatus("completed");
    deliveryDetail = run.finalCommitSha
      ? `Commit ${run.finalCommitSha.slice(0, 12)}`
      : "No commit required";
  } else if (run.status === "failed") {
    deliveryStatus = describeSupervisosRunStatus("failed");
  } else if (run.status === "cancelled") {
    deliveryStatus = describeSupervisosRunStatus("cancelled");
  }
  stations.push({
    id: "station:delivery",
    label: "Deliver",
    kind: "delivery",
    status: deliveryStatus,
    rounds: 1,
    ...(deliveryDetail ? { detail: deliveryDetail } : {}),
    pills: [],
    selectable: false,
  });
  return stations;
}

export function buildSupervisorRunTimeline(
  run: SupervisorRunClientUpdate
): RunTimelineModel {
  const plan = planStation(run);
  const tasks = taskStations(run);
  const lifecycle = lifecycleStations(run);
  const stations = [plan, ...tasks.stations, ...lifecycle];
  const indexById = new Map(
    stations.map((station, index) => [station.id, index])
  );
  const links: RunTimelineLink[] =
    tasks.degraded === "cyclic"
      ? []
      : run.tasks.flatMap((task) =>
          task.dependencies.flatMap((dependency) => {
            const from = indexById.get(`station:task:${dependency}`);
            const to = indexById.get(`station:task:${task.taskId}`);
            if (from === undefined || to === undefined || from === to) {
              return [];
            }
            return [{ from, to, kind: "dependency" as const }];
          })
        );
  return {
    stations,
    links,
    degraded: tasks.degraded,
  };
}

export const AGENT_IDENTITY_PALETTE_SIZE = 8;

export function agentIdentityClass(seed: string): string {
  const index =
    supervisosAgentIdentityIndex(seed, AGENT_IDENTITY_PALETTE_SIZE) + 1;
  return `agent-identity-${index}`;
}
