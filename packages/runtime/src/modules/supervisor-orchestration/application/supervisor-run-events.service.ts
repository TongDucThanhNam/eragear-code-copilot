import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import {
  deriveSupervisorRunStatus,
  deriveSupervisorTaskStatus,
} from "../domain/supervisor-run.projections";
import type { SupervisorRunState } from "../domain/supervisor-run.schemas";

export interface SubscribeSupervisorRunUpdatesInput {
  userId: string;
  projectId?: string;
  listener: (update: SupervisorRunClientUpdate) => void;
}

export class SupervisorRunEventsService {
  private readonly eventBus: EventBusPort;

  constructor(eventBus: EventBusPort) {
    this.eventBus = eventBus;
  }

  subscribe(input: SubscribeSupervisorRunUpdatesInput): () => void {
    return this.eventBus.subscribe((event) => {
      if (
        event.type !== "supervisor_run_updated" ||
        event.userId !== input.userId ||
        (input.projectId && event.projectId !== input.projectId)
      ) {
        return;
      }
      input.listener(event.update);
    });
  }
}

export function createClientSafeSupervisorRunUpdate(
  run: SupervisorRunState
): SupervisorRunClientUpdate {
  return {
    runId: run.runId,
    revision: run.revision,
    ...(run.projectId ? { projectId: run.projectId } : {}),
    ...(run.originatingChatId
      ? { originatingChatId: run.originatingChatId }
      : {}),
    ...(run.sourceGoalContract
      ? {
          sourceGoalContract: {
            intakeId: run.sourceGoalContract.intakeId,
            revisionId: run.sourceGoalContract.revisionId,
            ...(run.sourceGoalContract.revision
              ? { revision: run.sourceGoalContract.revision }
              : {}),
            hash: run.sourceGoalContract.hash,
            ...(run.sourceGoalContract.createdAt
              ? { createdAt: run.sourceGoalContract.createdAt }
              : {}),
            ...(run.sourceGoalContract.contract
              ? { contract: structuredClone(run.sourceGoalContract.contract) }
              : {}),
            criterionResolutions: run.goalCriterionResolutions.map(
              (resolution) => ({
                criterionId: resolution.criterionId,
                resolution: resolution.resolution,
                decisionId: resolution.decisionId,
                resolvedAt: resolution.resolvedAt,
              })
            ),
          },
        }
      : {}),
    status: deriveSupervisorRunStatus(run),
    priority: run.priority,
    ...(run.cancellation
      ? {
          cancellation: {
            status: run.cancellation.status,
            pendingSessionCount: run.cancellation.pendingSessionIds.length,
            pendingWorkspaceCount: run.cancellation.pendingWorkspaceIds.length,
            ...(run.cancellation.blockingDecisionId
              ? { blockingDecisionId: run.cancellation.blockingDecisionId }
              : {}),
          },
        }
      : {}),
    ...(run.managerSession
      ? {
          manager: {
            agentId: run.managerSession.agentId,
            chatId: run.managerSession.chatId,
            status: run.managerSession.status,
            exactResumeRequired: true as const,
          },
        }
      : {}),
    ...(run.plan
      ? {
          plan: {
            version: run.plan.version,
            hash: run.plan.hash,
            summary: run.plan.summary,
            ...(run.plan.approvedAt ? { approvedAt: run.plan.approvedAt } : {}),
            envelope: structuredClone(run.plan.envelope),
          },
        }
      : {}),
    tasks: run.tasks.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      role: task.role,
      executionMode: task.executionMode,
      dependencies: [...task.dependencies],
      criterionIds: [...task.criterionIds],
      changeKinds: [...task.changeKinds],
      ...(task.preferredModelId
        ? { preferredModelId: task.preferredModelId }
        : {}),
      status: deriveSupervisorTaskStatus(run, task),
      attempts: task.attempts.map((attempt) => ({
        attemptId: attempt.attemptId,
        chatId: attempt.chatId,
        agentId: attempt.agentId,
        ...(attempt.modelId ? { modelId: attempt.modelId } : {}),
        status: toClientAttemptStatus(attempt.status),
        ...(attempt.result
          ? { files: structuredClone(attempt.result.files) }
          : {}),
        verification:
          attempt.result?.verification.map((item) => ({
            command: item.command,
            exitCode: item.exitCode,
          })) ?? [],
      })),
    })),
    limits: {
      maxAttemptsPerTask: run.limits.maxAttemptsPerTask,
    },
    gates: run.gates.map((gate) => ({
      gateId: gate.gateId,
      taskId: gate.taskId,
      attemptId: gate.attemptId,
      kind: gate.kind,
      status: gate.status,
    })),
    capacityWaits: run.capacityWaits.map((wait) => ({
      waitId: wait.waitId,
      owner: wait.owner,
      ...(wait.taskId ? { taskId: wait.taskId } : {}),
      ...(wait.attemptId ? { attemptId: wait.attemptId } : {}),
      agentId: wait.agentId,
      kind: wait.kind,
      retryAt: wait.retryAt,
      ...(wait.resetAt ? { resetAt: wait.resetAt } : {}),
    })),
    decisions: run.decisions.map((decision) => ({
      decisionId: decision.decisionId,
      kind: decision.kind,
      status: decision.status,
      prompt: decision.prompt,
      createdAt: decision.createdAt,
      ...(decision.answeredAt ? { answeredAt: decision.answeredAt } : {}),
      ...(decision.criterionIds
        ? { criterionIds: [...decision.criterionIds] }
        : {}),
    })),
    finalVerification: run.finalVerification.map((item) => ({
      command: item.command,
      exitCode: item.exitCode,
    })),
    ...(run.finalCommitSha ? { finalCommitSha: run.finalCommitSha } : {}),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

type SupervisorClientAttemptStatus =
  SupervisorRunClientUpdate["tasks"][number]["attempts"][number]["status"];

function toClientAttemptStatus(
  status: SupervisorRunState["tasks"][number]["attempts"][number]["status"]
): SupervisorClientAttemptStatus {
  return status === "uncertain" ? "running" : status;
}
