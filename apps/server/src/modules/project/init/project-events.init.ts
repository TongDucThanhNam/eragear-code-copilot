import type { SessionUseCases } from "@/modules/use-cases";
import type { EventBusPort } from "@/shared/ports/event-bus.port";

export interface ProjectEventsInitParams {
  eventBus: EventBusPort;
  sessionUseCases: Pick<SessionUseCases, "cleanupProjectSessions">;
}

export function initializeProjectEvents(
  params: ProjectEventsInitParams
): () => void {
  const { eventBus, sessionUseCases } = params;
  return eventBus.subscribe(async (event) => {
    if (event.type !== "project_deleting") {
      return;
    }
    await sessionUseCases.cleanupProjectSessions.execute({
      userId: event.userId,
      projectId: event.projectId,
      projectPath: event.projectPath,
    });
  });
}
