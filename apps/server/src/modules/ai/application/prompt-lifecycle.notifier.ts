import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { PromptLifecycleEvents } from "./send-message/send-message.types";

export function createEventBusPromptLifecycleNotifier(params: {
  eventBus: EventBusPort;
  logger: LoggerPort;
}): PromptLifecycleEvents {
  const { eventBus, logger } = params;
  return {
    async afterMessageSend(input) {
      await eventBus.publish({
        type: "prompt_message_sent",
        userId: input.userId,
        projectRoot: input.projectRoot,
        source: input.source,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        chatId: input.chatId,
        ...(input.agentSessionId
          ? { agentSessionId: input.agentSessionId }
          : {}),
        turnId: input.turnId,
      });
    },
    async requestSubagentInvocation(input) {
      await eventBus.publish({
        type: "subagent_invocation_requested",
        userId: input.userId,
        projectRoot: input.projectRoot,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        chatId: input.chatId,
        ...(input.agentSessionId
          ? { agentSessionId: input.agentSessionId }
          : {}),
        turnId: input.turnId,
        subagent: {
          name: input.subagent.name,
          ...(input.subagent.description
            ? { description: input.subagent.description }
            : {}),
          sourcePath: input.subagent.sourcePath,
        },
      });
    },
    async afterTurnComplete(event) {
      await eventBus
        .publish({
          type: "prompt_turn_completed",
          userId: event.userId,
          projectRoot: event.projectRoot,
          source: event.source,
          ...(event.projectId ? { projectId: event.projectId } : {}),
          chatId: event.chatId,
          ...(event.agentSessionId
            ? { agentSessionId: event.agentSessionId }
            : {}),
          turnId: event.turnId,
          stopReason: event.stopReason,
        })
        .catch((error) => {
          logger.warn("Prompt turn lifecycle event publish failed", {
            chatId: event.chatId,
            turnId: event.turnId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    },
  };
}

export const noopPromptLifecycleNotifier: PromptLifecycleEvents = {
  afterMessageSend: () => Promise.resolve(),
  requestSubagentInvocation: () => Promise.resolve(),
  afterTurnComplete: () => Promise.resolve(),
};
