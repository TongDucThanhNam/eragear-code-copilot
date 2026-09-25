import type { SupervisorRunDetailClientView } from "@eragear-code-copilot/shared";
import {
  deriveSupervisorRunStatus,
  deriveSupervisorTaskStatus,
} from "./supervisor-run.projections";
import type { SupervisorRunState } from "./supervisor-run.schemas";

/**
 * Bounds for the client-safe run detail projection. Every bounded collection
 * reports its untruncated total so UI can say "and N more" honestly; bounded
 * free text is hard-truncated with an ellipsis marker.
 */
export const SUPERVISOR_RUN_DETAIL_LIMITS = {
  auditEntries: 120,
  auditSummaryChars: 400,
  promptChars: 4000,
  intentChars: 2000,
  summaryChars: 1200,
  reasonChars: 600,
  gateReasonChars: 800,
  pathsPerList: 64,
  pathsPerManifest: 100,
  verificationCommands: 16,
  renamedPerManifest: 64,
  permissions: 16,
  toolFailures: 16,
  finalVerification: 64,
} as const;

const TRUNCATION_MARKER = "…";

function boundText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}${TRUNCATION_MARKER}`;
}

interface BoundedPathList {
  paths: string[];
  total: number;
}

function boundPaths(values: readonly string[], limit: number): BoundedPathList {
  return {
    paths: values.slice(0, limit),
    total: values.length,
  };
}

function attemptDetailOf(
  attempt: SupervisorRunState["tasks"][number]["attempts"][number],
  limits: typeof SUPERVISOR_RUN_DETAIL_LIMITS
): SupervisorRunDetailClientView["tasks"][number]["attempts"][number] {
  return {
    attemptId: attempt.attemptId,
    chatId: attempt.chatId,
    agentId: attempt.agentId,
    ...(attempt.modelId ? { modelId: attempt.modelId } : {}),
    status: attempt.status,
    ...(attempt.result?.semanticStatus
      ? { semanticStatus: attempt.result.semanticStatus }
      : {}),
    startedAt: attempt.startedAt,
    ...(attempt.finishedAt ? { finishedAt: attempt.finishedAt } : {}),
    ...(attempt.result?.outcomeSummary
      ? {
          outcomeSummary: boundText(
            attempt.result.outcomeSummary,
            limits.summaryChars
          ),
        }
      : {}),
    ...(attempt.result?.reason
      ? { reason: boundText(attempt.result.reason, limits.reasonChars) }
      : {}),
    ...(attempt.result?.patch
      ? {
          checkpoint: {
            sha256: attempt.result.patch.sha256,
            byteLength: attempt.result.patch.byteLength,
          },
        }
      : {}),
    files: attempt.result
      ? {
          touched: boundPaths(
            attempt.result.files.touched,
            limits.pathsPerManifest
          ),
          created: boundPaths(
            attempt.result.files.created,
            limits.pathsPerManifest
          ),
          deleted: boundPaths(
            attempt.result.files.deleted,
            limits.pathsPerManifest
          ),
          renamed: attempt.result.files.renamed.slice(
            0,
            limits.renamedPerManifest
          ),
        }
      : {
          touched: { paths: [], total: 0 },
          created: { paths: [], total: 0 },
          deleted: { paths: [], total: 0 },
          renamed: [],
        },
    verification:
      attempt.result?.verification
        .slice(0, limits.finalVerification)
        .map((item) => ({
          command: item.command,
          exitCode: item.exitCode,
          ...(item.outputSummary
            ? {
                outputSummary: boundText(
                  item.outputSummary,
                  limits.summaryChars
                ),
              }
            : {}),
        })) ?? [],
    unresolvedPermissions:
      attempt.result?.unresolvedPermissions
        .slice(0, limits.permissions)
        .map((permission) => boundText(permission, limits.reasonChars))
        .filter((permission) => permission.length > 0) ?? [],
    toolFailureSummary:
      attempt.result?.toolFailureSummary
        .slice(0, limits.toolFailures)
        .map((failure) => boundText(failure, limits.reasonChars))
        .filter((failure) => failure.length > 0) ?? [],
    ...(attempt.workspace
      ? {
          workspace: {
            kind: attempt.workspace.kind,
            ...(attempt.workspace.baseHead
              ? { baseHead: attempt.workspace.baseHead }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * One read-only mapping from the persisted run state to the bounded client
 * detail view. Pure: no IO, no scheduling, no authority. Anything sensitive
 * (project roots, workspace paths, patch storage refs, session internals,
 * prompt hashes) is intentionally absent from the output type, so leaks are
 * type-level impossible rather than filter-level hopeful.
 */
export function createClientSafeSupervisorRunDetail(
  run: SupervisorRunState
): SupervisorRunDetailClientView {
  const limits = SUPERVISOR_RUN_DETAIL_LIMITS;
  const orderedAudit = [...run.audit].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  );
  const auditEntries = orderedAudit.slice(-limits.auditEntries);
  return {
    runId: run.runId,
    revision: run.revision,
    ...(run.projectId ? { projectId: run.projectId } : {}),
    status: deriveSupervisorRunStatus(run),
    phase: run.phase,
    desiredState: run.desiredState,
    ...(run.outcome ? { outcome: run.outcome } : {}),
    plannerReplanCount: run.plannerReplanCount,
    ...(run.originalIntent
      ? { originalIntent: boundText(run.originalIntent, limits.intentChars) }
      : {}),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    tasks: run.tasks.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      prompt: boundText(task.goal, limits.promptChars),
      role: task.role,
      executionMode: task.executionMode,
      dependencies: [...task.dependencies],
      criterionIds: [...task.criterionIds],
      status: deriveSupervisorTaskStatus(run, task),
      ...(task.outcome ? { outcome: task.outcome } : {}),
      ...(task.blockingDecisionId
        ? { blockingDecisionId: task.blockingDecisionId }
        : {}),
      ...(task.notBefore ? { notBefore: task.notBefore } : {}),
      filesAllowed: boundPaths(task.filesAllowed, limits.pathsPerList),
      verificationCommands: task.verificationCommands.slice(
        0,
        limits.verificationCommands
      ),
      attempts: task.attempts.map((attempt) =>
        attemptDetailOf(attempt, limits)
      ),
    })),
    gates: run.gates.map((gate) => ({
      gateId: gate.gateId,
      taskId: gate.taskId,
      attemptId: gate.attemptId,
      kind: gate.kind,
      status: gate.status,
      reason: boundText(gate.reason, limits.gateReasonChars),
      createdAt: gate.createdAt,
      ...(gate.decidedAt ? { decidedAt: gate.decidedAt } : {}),
    })),
    audit: {
      entries: auditEntries.map((entry) => ({
        auditId: entry.auditId,
        kind: entry.kind,
        createdAt: entry.createdAt,
        actor: entry.actor,
        summary: boundText(entry.summary, limits.auditSummaryChars),
        ...(entry.taskId ? { taskId: entry.taskId } : {}),
        ...(entry.attemptId ? { attemptId: entry.attemptId } : {}),
      })),
      total: run.audit.length,
      truncated: run.audit.length > auditEntries.length,
    },
    finalVerification: run.finalVerification
      .slice(0, limits.finalVerification)
      .map((item) => ({
        command: item.command,
        exitCode: item.exitCode,
        ...(item.outputSummary
          ? {
              outputSummary: boundText(item.outputSummary, limits.summaryChars),
            }
          : {}),
        ...(item.startedAt ? { startedAt: item.startedAt } : {}),
        ...(item.finishedAt ? { finishedAt: item.finishedAt } : {}),
      })),
    ...(run.finalCommitSha ? { finalCommitSha: run.finalCommitSha } : {}),
  };
}
