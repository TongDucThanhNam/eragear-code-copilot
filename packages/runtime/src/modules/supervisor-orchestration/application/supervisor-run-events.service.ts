import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
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
    status: run.status,
    priority: run.priority,
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
      status: task.status,
      attempts: task.attempts.map((attempt) => ({
        attemptId: attempt.attemptId,
        chatId: attempt.chatId,
        agentId: attempt.agentId,
        status: attempt.status,
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
