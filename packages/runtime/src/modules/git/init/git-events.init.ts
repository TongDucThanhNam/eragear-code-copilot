import type { SessionRuntimePort } from "#runtime/modules/session";
import type { GitUseCases } from "#runtime/modules/use-cases";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import { subscribeDomainEvents } from "#runtime/shared/utils/domain-event-subscription.util";

interface InitializeGitEventsParams {
  eventBus: EventBusPort;
  gitUseCases: GitUseCases;
  sessionRuntime: SessionRuntimePort;
  logger: LoggerPort;
}

export function initializeGitEvents(
  params: InitializeGitEventsParams
): () => void {
  const { eventBus, gitUseCases, logger, sessionRuntime } = params;
  return subscribeDomainEvents({
    eventBus,
    types: ["prompt_turn_started", "prompt_turn_completed"],
    async handler(event) {
      const lifecycleInput = {
        userId: event.userId,
        projectRoot: event.projectRoot,
        ...(event.projectId ? { projectId: event.projectId } : {}),
        chatId: event.chatId,
        ...(event.agentSessionId
          ? { agentSessionId: event.agentSessionId }
          : {}),
        turnId: event.turnId,
      };
      if (event.type === "prompt_turn_started") {
        await gitUseCases.checkpoints.captureTurnBaseline(lifecycleInput);
        return;
      }
      const diff =
        await gitUseCases.checkpoints.captureCompletedTurn(lifecycleInput);
      await gitUseCases.checkpoints.createAutomaticCheckpoint({
        ...lifecycleInput,
      });
      await sessionRuntime.broadcast(event.chatId, {
        type: "prompt_turn_diff_ready",
        turnId: event.turnId,
        turnCount: diff.to.turnCount,
        files: diff.files,
      });
    },
    onError(error, event) {
      logger.warn("Git turn checkpoint lifecycle failed", {
        projectRoot: event.projectRoot,
        projectId: event.projectId,
        chatId: event.chatId,
        turnId: event.turnId,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
}
