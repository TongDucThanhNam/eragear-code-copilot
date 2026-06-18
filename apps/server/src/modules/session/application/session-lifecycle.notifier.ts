import type { EventBusPort } from "@/shared/ports/event-bus.port";

export interface AgentSessionLifecycleContext {
  userId: string;
  projectRoot: string;
  projectId?: string;
  chatId: string;
  agentSessionId?: string;
}

export interface AgentSessionStoppedContext
  extends AgentSessionLifecycleContext {
  stopReason?: string;
}

export interface SessionDeletedContext {
  userId: string;
  chatId: string;
}

export interface SessionLifecycleNotifier {
  agentSessionCreated(input: AgentSessionLifecycleContext): Promise<void>;
  agentSessionStopped(input: AgentSessionStoppedContext): Promise<void>;
  sessionDeleted(input: SessionDeletedContext): Promise<void>;
}

export function createEventBusSessionLifecycleNotifier(
  eventBus: EventBusPort
): SessionLifecycleNotifier {
  return {
    async agentSessionCreated(input) {
      await eventBus.publish({
        type: "agent_session_created",
        userId: input.userId,
        projectRoot: input.projectRoot,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        chatId: input.chatId,
        ...(input.agentSessionId
          ? { agentSessionId: input.agentSessionId }
          : {}),
      });
    },
    async agentSessionStopped(input) {
      await eventBus.publish({
        type: "agent_session_stopped",
        userId: input.userId,
        projectRoot: input.projectRoot,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        chatId: input.chatId,
        ...(input.agentSessionId
          ? { agentSessionId: input.agentSessionId }
          : {}),
        ...(input.stopReason ? { stopReason: input.stopReason } : {}),
      });
      await eventBus.publish({
        type: "dashboard_refresh",
        reason: "session_stopped",
        userId: input.userId,
        chatId: input.chatId,
      });
    },
    async sessionDeleted(input) {
      await eventBus.publish({
        type: "dashboard_refresh",
        reason: "session_deleted",
        userId: input.userId,
        chatId: input.chatId,
      });
    },
  };
}

export const noopSessionLifecycleNotifier: SessionLifecycleNotifier = {
  agentSessionCreated: () => Promise.resolve(),
  agentSessionStopped: () => Promise.resolve(),
  sessionDeleted: () => Promise.resolve(),
};
