import type { SessionUseCases } from "#runtime/modules/use-cases";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import { subscribeDomainEvents } from "#runtime/shared/utils/domain-event-subscription.util";

export interface ProjectEventsInitParams {
  eventBus: EventBusPort;
  sessionUseCases: Pick<SessionUseCases, "cleanupProjectSessions">;
}

export function initializeProjectEvents(
  params: ProjectEventsInitParams
): () => void {
  const { eventBus, sessionUseCases } = params;
  return subscribeDomainEvents({
    eventBus,
    types: ["project_deleting"],
    async handler(event) {
      await sessionUseCases.cleanupProjectSessions.execute({
        userId: event.userId,
        projectId: event.projectId,
        projectPath: event.projectPath,
      });
    },
  });
}
