import type { BotsUseCases } from "@/modules/use-cases";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LoggerPort } from "@/shared/ports/logger.port";

export function initializeBotAutomationEvents(params: {
  eventBus: EventBusPort;
  botsUseCases: BotsUseCases;
  logger: LoggerPort;
}): () => void {
  const { botsUseCases, eventBus, logger } = params;
  return eventBus.subscribe(async (event, context) => {
    if (context.signal.aborted) {
      return;
    }
    try {
      if (event.type === "provider_quota_refreshed") {
        await botsUseCases.bots.recordQuotaSnapshot(event);
        return;
      }
      if (event.type !== "local_ade_lifecycle") {
        return;
      }
      if (event.event === "after-agent-turn-complete") {
        await botsUseCases.bots.completeRunsForTurn(event);
        return;
      }
      if (event.event === "after-agent-session-stop") {
        await botsUseCases.bots.stopRunsForSession(event);
      }
    } catch (error) {
      logger.warn("Bot automation event handling failed", {
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
