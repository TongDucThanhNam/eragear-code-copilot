import type { BotsUseCases } from "#runtime/modules/use-cases";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import { subscribeDomainEvents } from "#runtime/shared/utils/domain-event-subscription.util";

export function initializeBotAutomationEvents(params: {
  eventBus: EventBusPort;
  botsUseCases: BotsUseCases;
  logger: LoggerPort;
}): () => void {
  const { botsUseCases, eventBus, logger } = params;
  return subscribeDomainEvents({
    eventBus,
    types: [
      "provider_quota_refreshed",
      "prompt_turn_completed",
      "agent_session_stopped",
      "supervisor_run_updated",
    ],
    async handler(event) {
      if (event.type === "provider_quota_refreshed") {
        await botsUseCases.bots.recordQuotaSnapshot({
          userId: event.userId,
          providerId: event.providerId,
          providerDisplayName: event.providerDisplayName,
          status: event.status,
          windows: event.windows.map((window) => ({
            id: window.id,
            ...(window.windowType ? { windowType: window.windowType } : {}),
            label: window.label,
            ...(window.percentRemaining !== undefined
              ? { percentRemaining: window.percentRemaining }
              : {}),
            ...(window.remaining !== undefined
              ? { remaining: window.remaining }
              : {}),
            ...(window.resetAt ? { resetAt: window.resetAt } : {}),
          })),
        });
        if (event.changed) {
          await botsUseCases.bots.dispatchDueQuotaResets({
            userIds: [event.userId],
            now: event.fetchedAt,
          });
        }
        return;
      }
      if (event.type === "prompt_turn_completed") {
        await botsUseCases.bots.completeRunsForTurn({
          userId: event.userId,
          chatId: event.chatId,
          turnId: event.turnId,
          ...(event.stopReason ? { stopReason: event.stopReason } : {}),
        });
        return;
      }
      if (event.type === "supervisor_run_updated") {
        await botsUseCases.bots.completeRunsForSupervisorUpdate({
          userId: event.userId,
          runId: event.update.runId,
          status: event.update.status,
        });
        return;
      }
      await botsUseCases.bots.stopRunsForSession({
        userId: event.userId,
        chatId: event.chatId,
        ...(event.stopReason ? { stopReason: event.stopReason } : {}),
      });
    },
    onError(error, event) {
      logger.warn("Bot automation event handling failed", {
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
}
