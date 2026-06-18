import type { EventBusPort } from "@/shared/ports/event-bus.port";

export interface AgentIdentity {
  userId: string;
  agentId: string;
}

export interface AgentLifecycleNotifier {
  agentCreated(input: AgentIdentity): Promise<void>;
  agentUpdated(input: AgentIdentity): Promise<void>;
  agentDeleted(input: AgentIdentity): Promise<void>;
}

export function createEventBusAgentLifecycleNotifier(
  eventBus: EventBusPort
): AgentLifecycleNotifier {
  return {
    async agentCreated(input) {
      await eventBus.publish({
        type: "dashboard_refresh",
        reason: "agent_created",
        userId: input.userId,
        agentId: input.agentId,
      });
    },
    async agentUpdated(input) {
      await eventBus.publish({
        type: "dashboard_refresh",
        reason: "agent_updated",
        userId: input.userId,
        agentId: input.agentId,
      });
    },
    async agentDeleted(input) {
      await eventBus.publish({
        type: "dashboard_refresh",
        reason: "agent_deleted",
        userId: input.userId,
        agentId: input.agentId,
      });
    },
  };
}
