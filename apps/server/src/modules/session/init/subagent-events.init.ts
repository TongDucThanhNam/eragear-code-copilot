import type { SessionUseCases } from "@/modules/use-cases";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LoggerPort } from "@/shared/ports/logger.port";

interface InitializeSubagentEventsParams {
  eventBus: EventBusPort;
  sessionUseCases: SessionUseCases;
  logger: LoggerPort;
}

export function initializeSubagentEvents(
  params: InitializeSubagentEventsParams
): () => void {
  const { eventBus, sessionUseCases, logger } = params;
  return eventBus.subscribe(async (event) => {
    try {
      if (event.type === "subagent_invocation_requested") {
        await sessionUseCases.subagents.startInvocationFromEvent(event);
        return;
      }
      if (
        event.type === "local_ade_lifecycle" &&
        event.event === "after-agent-turn-complete"
      ) {
        await sessionUseCases.subagents.completeInvocationsForTurn(event);
      }
    } catch (error) {
      logger.warn("Subagent lifecycle event handling failed", {
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
