import type { BroadcastEvent } from "@repo/shared";
import type { MessageState } from "./use-chat-message-state";

export function describeDeltaTarget(params: {
  event: Extract<BroadcastEvent, { type: "ui_message_delta" }>;
  state: MessageState;
}) {
  const baseMessage = params.state.byId.get(params.event.messageId);
  const deltaTargetPart = baseMessage?.parts[params.event.partIndex];
  const hasPart =
    deltaTargetPart?.type === "text" || deltaTargetPart?.type === "reasoning";
  return {
    baseMessage,
    hasPart,
  };
}

export function logChatStreamDebug(params: {
  event: BroadcastEvent;
  activeChatId: string | null;
  state: MessageState;
}) {
  const { event, activeChatId, state } = params;
  if (event.type === "ui_message") {
    console.debug("[Chat] Received ui_message", {
      chatId: activeChatId,
      messageId: event.message.id,
      partsCount: event.message.parts.length,
      knownMessages: state.order.length,
    });
    return;
  }
  if (event.type === "ui_message_part") {
    console.debug("[Chat] Received ui_message_part", {
      chatId: activeChatId,
      messageId: event.messageId,
      partIndex: event.partIndex,
      partType: event.part.type,
      isNew: event.isNew,
      knownMessages: state.order.length,
    });
    return;
  }
  if (event.type !== "ui_message_delta") {
    return;
  }
  const deltaTarget = describeDeltaTarget({ event, state });
  console.debug("[Chat] Received ui_message_delta", {
    chatId: activeChatId,
    messageId: event.messageId,
    partIndex: event.partIndex,
    deltaLength: event.delta.length,
    hasBaseMessage: Boolean(deltaTarget.baseMessage),
    hasPart: deltaTarget.hasPart,
    knownMessages: state.order.length,
  });
}
