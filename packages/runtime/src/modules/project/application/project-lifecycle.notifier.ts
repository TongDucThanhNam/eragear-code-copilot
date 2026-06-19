import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";

export interface ProjectIdentity {
  userId: string;
  projectId: string;
}

export interface ProjectDeletionIdentity extends ProjectIdentity {
  projectPath: string;
}

export interface ProjectLifecycleNotifier {
  projectCreated(input: ProjectIdentity): Promise<void>;
  projectUpdated(input: ProjectIdentity): Promise<void>;
  projectSetActive(input: {
    userId: string;
    projectId?: string;
  }): Promise<void>;
  beforeProjectDelete(input: ProjectDeletionIdentity): Promise<void>;
  afterProjectDeleted(input: ProjectDeletionIdentity): Promise<void>;
}

export function createEventBusProjectLifecycleNotifier(
  eventBus: EventBusPort
): ProjectLifecycleNotifier {
  return {
    async projectCreated(input) {
      await eventBus.publish({
        type: "dashboard_refresh",
        reason: "project_created",
        userId: input.userId,
        projectId: input.projectId,
      });
    },
    async projectUpdated(input) {
      await eventBus.publish({
        type: "dashboard_refresh",
        reason: "project_updated",
        userId: input.userId,
        projectId: input.projectId,
      });
    },
    async projectSetActive(input) {
      await eventBus.publish({
        type: "dashboard_refresh",
        reason: "project_set_active",
        userId: input.userId,
        projectId: input.projectId,
      });
    },
    async beforeProjectDelete(input) {
      await eventBus.publish({
        type: "project_deleting",
        userId: input.userId,
        projectId: input.projectId,
        projectPath: input.projectPath,
      });
    },
    async afterProjectDeleted(input) {
      await eventBus.publish({
        type: "project_deleted",
        userId: input.userId,
        projectId: input.projectId,
        projectPath: input.projectPath,
      });
      await eventBus.publish({
        type: "dashboard_refresh",
        reason: "project_deleted",
        userId: input.userId,
        projectId: input.projectId,
      });
    },
  };
}
