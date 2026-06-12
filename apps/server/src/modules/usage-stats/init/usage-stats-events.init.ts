import type { UsageStatsUseCases } from "@/modules/use-cases";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LoggerPort } from "@/shared/ports/logger.port";

export function initializeUsageStatsEvents(params: {
  eventBus: EventBusPort;
  usageStatsUseCases: UsageStatsUseCases;
  logger: LoggerPort;
}): () => void {
  const { eventBus, logger, usageStatsUseCases } = params;
  return eventBus.subscribe((event, context) => {
    if (context.signal.aborted) {
      return;
    }
    if (event.type === "local_ade_lifecycle") {
      queueMicrotask(() => {
        usageStatsUseCases.usageStats
          .recordLifecycleEvent(event)
          .catch((error) => {
            logger.warn("Failed to record lifecycle usage stats", {
              event: event.event,
              chatId: event.chatId,
              turnId: event.turnId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      });
      return;
    }
    if (event.type !== "provider_quota_refreshed") {
      return;
    }
    queueMicrotask(() => {
      usageStatsUseCases.usageStats
        .recordQuotaRefreshedEvent(event)
        .catch((error) => {
          logger.warn("Failed to record quota usage stats", {
            providerId: event.providerId,
            status: event.status,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
  });
}
