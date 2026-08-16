import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import { subscribeDomainEvents } from "#runtime/shared/utils/domain-event-subscription.util";
import type { AcpCapacityCoordinator } from "../application/acp-capacity-coordinator.service";
import type {
  AcpManagerResultReaderPort,
  AcpManagerSessionCoordinator,
} from "../application/acp-manager-session-coordinator.service";
import type { WorkerSessionManagerPort } from "../application/ports/worker-session-manager.port";
import type { SupervisorOrchestratorService } from "../application/supervisor-orchestrator.service";

export function initializeSupervisorOrchestrationEvents(params: {
  eventBus: EventBusPort;
  workerSessions: WorkerSessionManagerPort;
  manager?: Pick<
    AcpManagerSessionCoordinator,
    "claimCompletedTurn" | "claimStoppedTurn" | "resumePending"
  >;
  workerResults: AcpManagerResultReaderPort;
  capacity?: Pick<AcpCapacityCoordinator, "resumeDue">;
  globalScheduler?: { tick(maxDispatches?: number): Promise<string[]> };
  orchestrator: Pick<SupervisorOrchestratorService, "recordWorkerTerminal"> &
    Partial<Pick<SupervisorOrchestratorService, "recordManagerTurn">>;
  logger: LoggerPort;
}): () => void {
  return subscribeDomainEvents({
    eventBus: params.eventBus,
    types: [
      "prompt_turn_completed",
      "agent_session_stopped",
      "supervisor_turn_terminal",
      "supervisor_capacity_resumed",
      "provider_quota_refreshed",
    ],
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This is the single typed event router for mutually exclusive orchestration lifecycle events.
    async handler(event) {
      if (event.type === "agent_session_stopped") {
        const managerStop = await params.manager?.claimStoppedTurn({
          userId: event.userId,
          chatId: event.chatId,
          ...(event.stopReason ? { reason: event.stopReason } : {}),
        });
        if (managerStop) {
          return;
        }
        const binding = await params.workerSessions.claimStoppedSession({
          userId: event.userId,
          chatId: event.chatId,
          eventId: `${event.agentSessionId ?? event.chatId}:${event.stopReason ?? "stopped"}`,
        });
        if (!binding) {
          return;
        }
        await params.orchestrator.recordWorkerTerminal({
          runId: binding.runId,
          userId: binding.userId,
          taskId: binding.taskId,
          attemptId: binding.attemptId,
          action: "needs_user",
          reason:
            event.stopReason ??
            "ACP worker session stopped before completing its active turn",
          resultText: "",
        });
        return;
      }
      if (event.type === "provider_quota_refreshed") {
        if (
          event.status === "ready" &&
          event.changed &&
          event.windows.length > 0 &&
          !event.windows.some(isQuotaWindowExhausted)
        ) {
          await params.capacity?.resumeDue({
            userId: event.userId,
            capacityGroup: event.providerId,
            forceDue: true,
          });
        }
        return;
      }
      if (event.type === "supervisor_capacity_resumed") {
        if (event.owner === "manager") {
          await params.manager?.resumePending({
            runId: event.runId,
            userId: event.userId,
          });
        } else if (event.taskId && event.attemptId) {
          await params.workerSessions.resumePendingCapacity({
            runId: event.runId,
            userId: event.userId,
            taskId: event.taskId,
            attemptId: event.attemptId,
          });
        }
        await params.globalScheduler?.tick();
        return;
      }
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
      const managerTurn = params.manager
        ? await params.manager.claimCompletedTurn({
            userId: event.userId,
            chatId: event.chatId,
            turnId: event.turnId,
          })
        : null;
      if (managerTurn) {
        if (!params.orchestrator.recordManagerTurn) {
          throw new Error("Manager turn handler is not configured");
        }
        await params.orchestrator.recordManagerTurn({
          runId: managerTurn.runId,
          userId: managerTurn.userId,
          turn: managerTurn.turn,
        });
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
      const resultText = await params.workerResults.latestAssistantText({
        userId: event.userId,
        chatId: event.chatId,
      });
      await params.orchestrator.recordWorkerTerminal({
        runId: binding.runId,
        userId: binding.userId,
        taskId: binding.taskId,
        attemptId: binding.attemptId,
        action: resultText ? "done" : "needs_user",
        reason: resultText
          ? "ACP worker completed with a persisted assistant handoff"
          : "ACP worker completed without a persisted assistant result",
        resultText: resultText ?? "",
      });
    },
    onError(error, event) {
      params.logger.warn("Supervisor orchestration event handling failed", {
        eventType: event.type,
        chatId: "chatId" in event ? event.chatId : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
}

function isQuotaWindowExhausted(window: {
  percentRemaining?: number;
  remaining?: number;
  total?: number;
  unlimited?: boolean;
}) {
  if (window.unlimited) {
    return false;
  }
  if (window.percentRemaining !== undefined) {
    return window.percentRemaining <= 0;
  }
  return (
    window.remaining !== undefined &&
    window.remaining <= 0 &&
    window.total !== undefined &&
    window.total > 0
  );
}
