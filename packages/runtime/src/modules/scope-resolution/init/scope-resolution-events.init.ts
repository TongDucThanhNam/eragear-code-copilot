import type { ScopeResolutionUseCases } from "#runtime/modules/use-cases";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import { subscribeDomainEvents } from "#runtime/shared/utils/domain-event-subscription.util";

export function initializeScopeResolutionEvents(params: {
  eventBus: EventBusPort;
  scopeResolutionUseCases: ScopeResolutionUseCases;
  logger: LoggerPort;
}): () => void {
  const { eventBus, logger, scopeResolutionUseCases } = params;
  return subscribeDomainEvents({
    eventBus,
    types: ["file_watcher_file_changed"],
    async handler(event) {
      try {
        await scopeResolutionUseCases.scopeResolver.invalidateImportGraphFile({
          projectRoot: event.projectRoot,
          path: event.path,
        });
      } catch (error) {
        logger.warn("Failed to invalidate scope resolver import graph", {
          projectRoot: event.projectRoot,
          path: event.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}
