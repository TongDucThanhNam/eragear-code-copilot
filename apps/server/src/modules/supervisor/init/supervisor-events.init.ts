import type { SupervisorUseCases } from "@/modules/use-cases";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import { subscribeDomainEvents } from "@/shared/utils/domain-event-subscription.util";

export function initializeSupervisorEvents(params: {
  eventBus: EventBusPort;
  supervisorUseCases: SupervisorUseCases;
  logger: LoggerPort;
}): () => void {
  const { eventBus, logger, supervisorUseCases } = params;
  return subscribeDomainEvents({
    eventBus,
    types: ["prompt_turn_completed"],
    handler(event) {
      if (event.source === "automation") {
        return;
      }
      if (event.source !== "client" && event.source !== "supervisor") {
        return;
      }
      supervisorUseCases.loop.scheduleReview({
        chatId: event.chatId,
        userId: event.userId,
        turnId: event.turnId,
        stopReason: event.stopReason,
        source: event.source,
      });
    },
    onError(error, event) {
      logger.warn("Supervisor event handling failed", {
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
}
