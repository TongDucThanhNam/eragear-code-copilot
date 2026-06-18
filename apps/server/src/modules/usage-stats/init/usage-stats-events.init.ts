import type { UsageStatsUseCases } from "@/modules/use-cases";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { DomainEvent } from "@/shared/types/domain-events.types";
import { subscribeDomainEvents } from "@/shared/utils/domain-event-subscription.util";

type UsageLifecycleEvent = Extract<
  DomainEvent,
  { type: "prompt_message_sent" | "prompt_turn_completed" }
>;

export function initializeUsageStatsEvents(params: {
  eventBus: EventBusPort;
  usageStatsUseCases: UsageStatsUseCases;
  logger: LoggerPort;
}): () => void {
  const { eventBus, logger, usageStatsUseCases } = params;
  return subscribeDomainEvents({
    eventBus,
    types: [
      "prompt_message_sent",
      "prompt_turn_completed",
      "provider_quota_refreshed",
    ],
    defer: true,
    async handler(event) {
      if (isUsageLifecycleEvent(event)) {
        await usageStatsUseCases.usageStats.recordLifecycleUsage({
          kind: toUsageLifecycleRecordKind(event),
          userId: event.userId,
          projectRoot: event.projectRoot,
          ...(event.projectId ? { projectId: event.projectId } : {}),
          chatId: event.chatId,
          ...(event.agentSessionId
            ? { agentSessionId: event.agentSessionId }
            : {}),
          turnId: event.turnId,
        });
        return;
      }
      await usageStatsUseCases.usageStats.recordQuotaRefresh({
        userId: event.userId,
        providerId: event.providerId,
        providerDisplayName: event.providerDisplayName,
        status: event.status,
      });
    },
    onError(error, event) {
      if (isUsageLifecycleEvent(event)) {
        logger.warn("Failed to record lifecycle usage stats", {
          event: event.type,
          chatId: event.chatId,
          turnId: event.turnId,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      logger.warn("Failed to record quota usage stats", {
        providerId: event.providerId,
        status: event.status,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
}

function isUsageLifecycleEvent(
  event: DomainEvent
): event is UsageLifecycleEvent {
  return (
    event.type === "prompt_message_sent" ||
    event.type === "prompt_turn_completed"
  );
}

function toUsageLifecycleRecordKind(
  event: UsageLifecycleEvent
): "prompt_sent" | "turn_completed" {
  if (event.type === "prompt_message_sent") {
    return "prompt_sent";
  }
  return "turn_completed";
}
