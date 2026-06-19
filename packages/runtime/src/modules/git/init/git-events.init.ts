import type { GitUseCases } from "#runtime/modules/use-cases";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import { subscribeDomainEvents } from "#runtime/shared/utils/domain-event-subscription.util";

interface InitializeGitEventsParams {
  eventBus: EventBusPort;
  gitUseCases: GitUseCases;
  logger: LoggerPort;
}

export function initializeGitEvents(
  params: InitializeGitEventsParams
): () => void {
  const { eventBus, gitUseCases, logger } = params;
  return subscribeDomainEvents({
    eventBus,
    types: ["prompt_turn_completed"],
    defer: true,
    async handler(event) {
      await gitUseCases.checkpoints.createAutomaticCheckpoint({
        userId: event.userId,
        projectRoot: event.projectRoot,
        ...(event.projectId ? { projectId: event.projectId } : {}),
        chatId: event.chatId,
        ...(event.agentSessionId
          ? { agentSessionId: event.agentSessionId }
          : {}),
        turnId: event.turnId,
      });
    },
    onError(error, event) {
      logger.warn("Automatic Git checkpoint failed", {
        projectRoot: event.projectRoot,
        projectId: event.projectId,
        chatId: event.chatId,
        turnId: event.turnId,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
}
