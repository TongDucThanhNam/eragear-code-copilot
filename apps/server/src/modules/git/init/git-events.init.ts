import type { GitUseCases } from "@/modules/use-cases";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LoggerPort } from "@/shared/ports/logger.port";

interface InitializeGitEventsParams {
  eventBus: EventBusPort;
  gitUseCases: GitUseCases;
  logger: LoggerPort;
}

export function initializeGitEvents(
  params: InitializeGitEventsParams
): () => void {
  const { eventBus, gitUseCases, logger } = params;
  return eventBus.subscribe((event, context) => {
    if (
      context.signal.aborted ||
      event.type !== "local_ade_lifecycle" ||
      event.event !== "after-agent-turn-complete"
    ) {
      return;
    }

    queueMicrotask(() => {
      gitUseCases.checkpoints
        .createAutomaticCheckpoint({
          userId: event.userId,
          projectRoot: event.projectRoot,
          ...(event.projectId ? { projectId: event.projectId } : {}),
          ...(event.chatId ? { chatId: event.chatId } : {}),
          ...(event.agentSessionId
            ? { agentSessionId: event.agentSessionId }
            : {}),
          ...(event.turnId ? { turnId: event.turnId } : {}),
        })
        .catch((error) => {
          logger.warn("Automatic Git checkpoint failed", {
            projectRoot: event.projectRoot,
            projectId: event.projectId,
            chatId: event.chatId,
            turnId: event.turnId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
  });
}
