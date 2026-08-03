import type { SupervisorLoopService } from "#runtime/modules/supervisor";
import type { UseCasePort } from "#runtime/modules/use-cases";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import { subscribeDomainEvents } from "#runtime/shared/utils/domain-event-subscription.util";
import type { WorkerSessionManagerPort } from "../application/ports/worker-session-manager.port";
import type { SupervisorOrchestratorService } from "../application/supervisor-orchestrator.service";

export function initializeSupervisorOrchestrationEvents(params: {
  eventBus: EventBusPort;
  workerSessions: WorkerSessionManagerPort;
  supervisorLoop: UseCasePort<SupervisorLoopService>;
  orchestrator: Pick<SupervisorOrchestratorService, "recordWorkerTerminal">;
  logger: LoggerPort;
}): () => void {
  return subscribeDomainEvents({
    eventBus: params.eventBus,
    types: ["prompt_turn_completed", "supervisor_turn_terminal"],
    async handler(event) {
      if (event.type === "supervisor_turn_terminal") {
        if (event.source !== "orchestrator") {
          return;
        }
        const binding = await params.workerSessions.claimTerminalDecision({
          userId: event.userId,
          chatId: event.chatId,
          eventId: `${event.chatId}:${event.turnId ?? "none"}:${event.action}`,
        });
        if (!binding) {
          return;
        }
        await params.orchestrator.recordWorkerTerminal({
          runId: binding.runId,
          userId: binding.userId,
          taskId: binding.taskId,
          attemptId: binding.attemptId,
          action: event.action,
          reason: event.reason,
          resultText: event.resultText,
        });
        return;
      }
      if (event.source !== "orchestrator") {
        return;
      }
      const binding = await params.workerSessions.claimCompletedTurn({
        userId: event.userId,
        chatId: event.chatId,
        turnId: event.turnId,
      });
      if (!binding) {
        return;
      }
      params.supervisorLoop.scheduleReview({
        chatId: event.chatId,
        userId: event.userId,
        turnId: event.turnId,
        stopReason: event.stopReason,
        source: "orchestrator",
      });
    },
    onError(error, event) {
      params.logger.warn("Supervisor orchestration event handling failed", {
        eventType: event.type,
        chatId: event.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
}
