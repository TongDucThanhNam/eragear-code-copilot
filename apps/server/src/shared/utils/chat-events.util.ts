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
  broadcast: (chatId: string, event: BroadcastEvent) => Promise<void>;
  status: ChatStatus;
  turnId?: string;
}): Promise<void> {
  const { chatId, session, broadcast, status } = params;
  if (!session || session.chatStatus === status) {
    return Promise.resolve();
  }
  session.chatStatus = status;
  const turnId = params.turnId ?? session.activeTurnId;
  return broadcast(chatId, {
    type: "chat_status",
    status,
    ...(turnId ? { turnId } : {}),
  });
}

export function setChatFinishStopReason(
  session: ChatSession,
  stopReason: string,
  turnId?: string
): void {
  session.chatFinish = {
    ...session.chatFinish,
    stopReason,
    ...(turnId ? { turnId } : {}),
  };
}

export function setChatFinishMessage(
  session: ChatSession,
  messageId: string,
  turnId?: string
): void {
  session.chatFinish = {
    ...session.chatFinish,
    messageId,
    ...(turnId ? { turnId } : {}),
  };
}

export function maybeBroadcastChatFinish(params: {
  chatId: string;
  session: ChatSession;
  broadcast: (chatId: string, event: BroadcastEvent) => Promise<void>;
}): Promise<void> {
  const { chatId, session, broadcast } = params;
  const stopReason = session.chatFinish?.stopReason;
  const messageId = session.chatFinish?.messageId;
  const turnId = session.chatFinish?.turnId;
  const isAssistantActive = Boolean(session.uiState.currentAssistantId);

  if (!stopReason || (!messageId && isAssistantActive)) {
    return Promise.resolve();
  }

  const resolvedMessageId = messageId ?? session.uiState.lastAssistantId;
  const message = resolvedMessageId
    ? session.uiState.messages.get(resolvedMessageId)
    : undefined;
  const finishReason = mapStopReasonToFinishReason(stopReason);

  return broadcast(chatId, {
    type: "chat_finish",
    stopReason,
    finishReason,
    messageId: resolvedMessageId,
    ...(message ? { message } : {}),
    isAbort: stopReason === "cancelled",
    ...(turnId ? { turnId } : {}),
  }).then(() => {
    session.chatFinish = undefined;
  });
}
