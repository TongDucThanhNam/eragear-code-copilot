import type { SessionUseCases } from "#runtime/modules/use-cases";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import { subscribeDomainEvents } from "#runtime/shared/utils/domain-event-subscription.util";

interface InitializeSubagentEventsParams {
  eventBus: EventBusPort;
  sessionUseCases: SessionUseCases;
  logger: LoggerPort;
}

export function initializeSubagentEvents(
  params: InitializeSubagentEventsParams
): () => void {
  const { eventBus, sessionUseCases, logger } = params;
  return subscribeDomainEvents({
    eventBus,
    types: ["subagent_invocation_requested", "prompt_turn_completed"],
    async handler(event) {
      if (event.type === "subagent_invocation_requested") {
        await sessionUseCases.subagents.startInvocation({
          userId: event.userId,
          chatId: event.chatId,
          ...(event.agentSessionId
            ? { agentSessionId: event.agentSessionId }
            : {}),
          turnId: event.turnId,
          subagent: {
            name: event.subagent.name,
            ...(event.subagent.description
              ? { description: event.subagent.description }
              : {}),
            sourcePath: event.subagent.sourcePath,
          },
        });
        return;
      }
      await sessionUseCases.subagents.completeInvocationsForTurn({
        userId: event.userId,
        chatId: event.chatId,
        turnId: event.turnId,
        ...(event.stopReason ? { stopReason: event.stopReason } : {}),
      });
    },
    onError(error, event) {
      logger.warn("Subagent lifecycle event handling failed", {
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
}
