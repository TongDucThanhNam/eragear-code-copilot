import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { SupervisorTerminalNotifierPort } from "./ports/supervisor-terminal.port";

const MAX_RESULT_TEXT_CHARS = 12_000;

export function createEventBusSupervisorTerminalNotifier(input: {
  eventBus: EventBusPort;
  logger: LoggerPort;
}): SupervisorTerminalNotifierPort {
  return {
    async notify(notification) {
      await input.eventBus
        .publish({
          type: "supervisor_turn_terminal",
          ...notification,
          resultText: notification.resultText.slice(0, MAX_RESULT_TEXT_CHARS),
        })
        .catch((error) => {
          input.logger.warn("Supervisor terminal event publish failed", {
            chatId: notification.chatId,
            turnId: notification.turnId ?? null,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    },
  };
}
