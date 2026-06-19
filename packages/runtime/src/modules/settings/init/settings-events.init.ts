import type { SettingsUseCases } from "#runtime/modules/use-cases";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import { subscribeDomainEvents } from "#runtime/shared/utils/domain-event-subscription.util";

type LocalAdeLifecycleHookSourceEvent = Extract<
  DomainEvent,
  {
    type:
      | "agent_session_created"
      | "prompt_message_sent"
      | "prompt_turn_completed"
      | "agent_session_stopped";
  }
>;

export function initializeSettingsEvents(params: {
  eventBus: EventBusPort;
  settingsUseCases: SettingsUseCases;
}): () => void {
  return subscribeDomainEvents({
    eventBus: params.eventBus,
    types: [
      "agent_session_created",
      "prompt_message_sent",
      "prompt_turn_completed",
      "agent_session_stopped",
    ],
    defer: true,
    handler(event) {
      return params.settingsUseCases.localAde.runLifecycleHooks({
        event: toLocalAdeHookEvent(event),
        userId: event.userId,
        projectRoot: event.projectRoot,
        projectId: event.projectId,
        chatId: event.chatId,
        agentSessionId: event.agentSessionId,
        ...("turnId" in event ? { turnId: event.turnId } : {}),
      });
    },
    onError() {
      return undefined;
    },
  });
}

function toLocalAdeHookEvent(
  event: LocalAdeLifecycleHookSourceEvent
):
  | "after-agent-session-create"
  | "after-agent-message-send"
  | "after-agent-turn-complete"
  | "after-agent-session-stop" {
  switch (event.type) {
    case "agent_session_created":
      return "after-agent-session-create";
    case "prompt_message_sent":
      return "after-agent-message-send";
    case "prompt_turn_completed":
      return "after-agent-turn-complete";
    case "agent_session_stopped":
      return "after-agent-session-stop";
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
