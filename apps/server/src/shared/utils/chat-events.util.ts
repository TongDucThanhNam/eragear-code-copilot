import type {
  BroadcastEvent,
  ChatFinishReason,
  ChatSession,
  ChatStatus,
} from "../types/session.types";

const STOP_REASON_TO_FINISH_REASON: Record<string, ChatFinishReason> = {
  end_turn: "stop",
  max_tokens: "length",
  max_turn_requests: "tool-calls",
  refusal: "content-filter",
  cancelled: "other",
};

export function mapStopReasonToFinishReason(
  stopReason?: string
): ChatFinishReason {
  if (!stopReason) {
    return "other";
  }
  return STOP_REASON_TO_FINISH_REASON[stopReason] ?? "other";
}

export function updateChatStatus(params: {
  chatId: string;
  session: ChatSession | undefined;
  broadcast: (chatId: string, event: BroadcastEvent) => void;
  status: ChatStatus;
}): void {
  const { chatId, session, broadcast, status } = params;
  if (!session || session.chatStatus === status) {
    return;
  }
  session.chatStatus = status;
  broadcast(chatId, { type: "chat_status", status });
}

export function setChatFinishStopReason(
  session: ChatSession,
  stopReason: string
): void {
  session.chatFinish = { ...session.chatFinish, stopReason };
}

export function setChatFinishMessage(
  session: ChatSession,
  messageId: string
): void {
  session.chatFinish = { ...session.chatFinish, messageId };
}

export function maybeBroadcastChatFinish(params: {
  chatId: string;
  session: ChatSession;
  broadcast: (chatId: string, event: BroadcastEvent) => void;
}): void {
  const { chatId, session, broadcast } = params;
  const stopReason = session.chatFinish?.stopReason;
  const messageId = session.chatFinish?.messageId;
  const isAssistantActive = Boolean(session.uiState.currentAssistantId);

  if (!stopReason || (!messageId && isAssistantActive)) {
    return;
  }

  const resolvedMessageId = messageId ?? session.uiState.lastAssistantId;
  const message = resolvedMessageId
    ? session.uiState.messages.get(resolvedMessageId)
    : undefined;
  const finishReason = mapStopReasonToFinishReason(stopReason);

  broadcast(chatId, {
    type: "chat_finish",
    stopReason,
    finishReason,
    messageId: resolvedMessageId,
    ...(message ? { message } : {}),
    isAbort: stopReason === "cancelled",
  });

  session.chatFinish = undefined;
}
