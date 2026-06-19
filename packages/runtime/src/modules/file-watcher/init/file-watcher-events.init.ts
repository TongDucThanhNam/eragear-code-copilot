import type { SessionRuntimePort } from "#runtime/modules/session";
import type { FileWatcherUseCases } from "#runtime/modules/use-cases";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import { subscribeDomainEvents } from "#runtime/shared/utils/domain-event-subscription.util";

export function initializeFileWatcherEvents(params: {
  eventBus: EventBusPort;
  fileWatcherUseCases: FileWatcherUseCases;
  sessionRuntime: SessionRuntimePort;
  logger: LoggerPort;
}): () => void {
  const { eventBus, fileWatcherUseCases, logger, sessionRuntime } = params;
  return subscribeDomainEvents({
    eventBus,
    types: [
      "agent_session_created",
      "prompt_message_sent",
      "agent_session_stopped",
      "file_watcher_file_changed",
    ],
    async handler(event) {
      if (
        event.type === "agent_session_created" ||
        event.type === "prompt_message_sent"
      ) {
        await fileWatcherUseCases.fileWatcher.watchSession({
          userId: event.userId,
          chatId: event.chatId,
          projectRoot: event.projectRoot,
          ...(event.projectId ? { projectId: event.projectId } : {}),
        });
        return;
      }
      if (event.type === "agent_session_stopped") {
        await fileWatcherUseCases.fileWatcher.unwatchSession({
          chatId: event.chatId,
        });
        return;
      }

      await Promise.all(
        event.sessions.map(async (session) => {
          try {
            await sessionRuntime.broadcast(session.chatId, {
              type: "file_modified",
              path: event.path,
            });
          } catch (error) {
            logger.warn("Failed to broadcast file watcher update", {
              chatId: session.chatId,
              path: event.path,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })
      );
    },
  });
}
