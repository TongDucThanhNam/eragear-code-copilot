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
    finalVerification: run.finalVerification.map((item) => ({
      command: item.command,
      exitCode: item.exitCode,
    })),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
