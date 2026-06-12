import type { SessionRuntimePort } from "@/modules/session";
import type { FileWatcherUseCases } from "@/modules/use-cases";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LoggerPort } from "@/shared/ports/logger.port";

export function initializeFileWatcherEvents(params: {
  eventBus: EventBusPort;
  fileWatcherUseCases: FileWatcherUseCases;
  sessionRuntime: SessionRuntimePort;
  logger: LoggerPort;
}): () => void {
  const { eventBus, fileWatcherUseCases, logger, sessionRuntime } = params;
  return eventBus.subscribe(async (event, context) => {
    if (context.signal.aborted) {
      return;
    }

    if (event.type === "local_ade_lifecycle") {
      if (
        (event.event === "after-agent-session-create" ||
          event.event === "after-agent-message-send") &&
        event.chatId
      ) {
        await fileWatcherUseCases.fileWatcher.watchSession({
          userId: event.userId,
          chatId: event.chatId,
          projectRoot: event.projectRoot,
          ...(event.projectId ? { projectId: event.projectId } : {}),
        });
      }
      if (event.event === "after-agent-session-stop" && event.chatId) {
        await fileWatcherUseCases.fileWatcher.unwatchSession({
          chatId: event.chatId,
        });
      }
      return;
    }

    if (event.type !== "file_watcher_file_changed") {
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
  });
}
