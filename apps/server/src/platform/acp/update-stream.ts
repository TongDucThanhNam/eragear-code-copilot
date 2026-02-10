import type { UIMessage } from "@repo/shared";
import type {
  SessionBufferingPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { createLogger } from "@/platform/logging/structured-logger";
import {
  maybeBroadcastChatFinish,
  setChatFinishMessage,
  updateChatStatus,
} from "@/shared/utils/chat-events.util";
import { toStoredContentBlock } from "@/shared/utils/content-block.util";
import {
  appendContentBlock,
  appendReasoningBlock,
  buildProviderMetadataFromMeta,
  finalizeStreamingParts,
  getOrCreateAssistantMessage,
  getOrCreateUserMessage,
} from "@/shared/utils/ui-message.util";
import type { SessionUpdateWithLegacy } from "./update-types";
import { isTurnBoundaryUpdate } from "./update-types";

const logger = createLogger("Debug");

export async function handleBufferedMessage(
  chatId: string,
  buffer: SessionBufferingPort,
  isReplayingHistory: boolean,
  update: SessionUpdateWithLegacy,
  sessionRepo: SessionRepositoryPort,
  sessionRuntime: SessionRuntimePort,
  finalizeStreamingForCurrentAssistant: (
    chatId: string,
    sessionRuntime: SessionRuntimePort
  ) => void
): Promise<void> {
  appendAgentChunksToBuffer(buffer, update);
  handleUiChunkUpdate({
    chatId,
    buffer,
    isReplayingHistory,
    update,
    sessionRuntime,
    finalizeStreamingForCurrentAssistant,
  });

  if (!isTurnBoundaryUpdate(update)) {
    return;
  }

  const session = sessionRuntime.get(chatId);
  await flushAndFinalizeTurn({
    chatId,
    session,
    buffer,
    isReplayingHistory,
    sessionRepo,
    sessionRuntime,
    sessionUpdate: update.sessionUpdate,
  });
}

function appendAgentChunksToBuffer(
  buffer: SessionBufferingPort,
  update: SessionUpdateWithLegacy
) {
  if (update.sessionUpdate === "agent_message_chunk") {
    buffer.appendContent(toStoredContentBlock(update.content));
    return;
  }
  if (update.sessionUpdate === "agent_thought_chunk") {
    buffer.appendReasoning(toStoredContentBlock(update.content));
  }
}

function handleUiChunkUpdate(params: {
  chatId: string;
  buffer: SessionBufferingPort;
  isReplayingHistory: boolean;
  update: SessionUpdateWithLegacy;
  sessionRuntime: SessionRuntimePort;
  finalizeStreamingForCurrentAssistant: (
    chatId: string,
    sessionRuntime: SessionRuntimePort
  ) => void;
}) {
  const {
    chatId,
    buffer,
    isReplayingHistory,
    update,
    sessionRuntime,
    finalizeStreamingForCurrentAssistant,
  } = params;
  const session = sessionRuntime.get(chatId);
  if (!session) {
    return;
  }
  const isMessageChunk = update.sessionUpdate === "agent_message_chunk";
  const isThoughtChunk = update.sessionUpdate === "agent_thought_chunk";
  if (
    !(isMessageChunk || isThoughtChunk) &&
    update.sessionUpdate !== "user_message_chunk"
  ) {
    return;
  }

  if (update.sessionUpdate === "user_message_chunk") {
    const message = getOrCreateUserMessage(session.uiState);
    const block = toStoredContentBlock(update.content);
    const partState = isReplayingHistory ? "done" : "streaming";
    const providerMetadata = buildProviderMetadataFromMeta(
      "_meta" in update ? update._meta : undefined
    );
    appendContentBlock(message, block, partState, providerMetadata);
    sessionRuntime.broadcast(chatId, { type: "ui_message", message });
    return;
  }

  const partState = isReplayingHistory ? "done" : "streaming";
  const providerMetadata = buildProviderMetadataFromMeta(
    "_meta" in update ? update._meta : undefined
  );
  const preferredMessageId = session.uiState.currentAssistantId;

  updateAssistantChunkType({
    chatId,
    session,
    update,
    sessionRuntime,
    finalizeStreamingForCurrentAssistant,
  });
  appendAssistantChunk({
    chatId,
    session,
    buffer,
    preferredMessageId,
    isReplayingHistory,
    update,
    partState,
    providerMetadata,
    sessionRuntime,
  });
}

function appendAssistantChunk(params: {
  chatId: string;
  session: NonNullable<ReturnType<SessionRuntimePort["get"]>>;
  buffer: SessionBufferingPort;
  preferredMessageId: string | undefined;
  isReplayingHistory: boolean;
  update: SessionUpdateWithLegacy;
  partState: "streaming" | "done";
  providerMetadata:
    | ReturnType<typeof buildProviderMetadataFromMeta>
    | undefined;
  sessionRuntime: SessionRuntimePort;
}) {
  const {
    chatId,
    session,
    buffer,
    preferredMessageId,
    isReplayingHistory,
    update,
    partState,
    providerMetadata,
    sessionRuntime,
  } = params;
  if (update.sessionUpdate === "agent_message_chunk") {
    const messageId = buffer.ensureMessageId(preferredMessageId);
    const message = getOrCreateAssistantMessage(session.uiState, messageId);
    const block = toStoredContentBlock(update.content);
    appendContentBlock(message, block, partState, providerMetadata);

    if (!isReplayingHistory) {
      sessionRuntime.broadcast(chatId, { type: "ui_message", message });
    }
    return;
  }
  if (update.sessionUpdate !== "agent_thought_chunk") {
    return;
  }
  const messageId = buffer.ensureMessageId(preferredMessageId);
  const message = getOrCreateAssistantMessage(session.uiState, messageId);
  const block = toStoredContentBlock(update.content);
  if (block.type !== "text") {
    return;
  }
  appendReasoningBlock(message, block, partState, providerMetadata);
}

function updateAssistantChunkType(params: {
  chatId: string;
  session: NonNullable<ReturnType<SessionRuntimePort["get"]>>;
  update: SessionUpdateWithLegacy;
  sessionRuntime: SessionRuntimePort;
  finalizeStreamingForCurrentAssistant: (
    chatId: string,
    sessionRuntime: SessionRuntimePort
  ) => void;
}) {
  const {
    chatId,
    session,
    update,
    sessionRuntime,
    finalizeStreamingForCurrentAssistant,
  } = params;
  if (
    update.sessionUpdate !== "agent_message_chunk" &&
    update.sessionUpdate !== "agent_thought_chunk"
  ) {
    return;
  }
  const nextChunkType =
    update.sessionUpdate === "agent_message_chunk" ? "message" : "reasoning";
  if (
    session.lastAssistantChunkType &&
    session.lastAssistantChunkType !== nextChunkType
  ) {
    finalizeStreamingForCurrentAssistant(chatId, sessionRuntime);
  }
  session.lastAssistantChunkType = nextChunkType;
}

async function flushAndFinalizeTurn(params: {
  chatId: string;
  session: ReturnType<SessionRuntimePort["get"]>;
  buffer: SessionBufferingPort;
  isReplayingHistory: boolean;
  sessionRepo: SessionRepositoryPort;
  sessionRuntime: SessionRuntimePort;
  sessionUpdate: "turn_end" | "prompt_end";
}): Promise<void> {
  const {
    chatId,
    session,
    buffer,
    isReplayingHistory,
    sessionRepo,
    sessionRuntime,
    sessionUpdate,
  } = params;
  const bufferedMessage = buffer.flush();
  const currentAssistantId = session?.uiState.currentAssistantId;
  const messageId = bufferedMessage?.id ?? currentAssistantId ?? null;
  const currentMessage = messageId
    ? session?.uiState.messages.get(messageId)
    : undefined;
  const hasParts = Boolean(currentMessage?.parts.length);
  const shouldPersist = Boolean(bufferedMessage) || hasParts;

  logger.debug("ACP buffered flush", {
    chatId,
    sessionUpdate,
    buffered: Boolean(bufferedMessage),
    bufferedContentLength: bufferedMessage?.content.length ?? 0,
    bufferedReasoningLength: bufferedMessage?.reasoning?.length ?? 0,
    currentAssistantId: currentAssistantId ?? undefined,
    hasParts,
    shouldPersist,
  });

  await persistBufferedAssistantMessage({
    chatId,
    isReplayingHistory,
    userId: session?.userId,
    messageId,
    shouldPersist,
    currentMessage,
    bufferedMessage,
    sessionRepo,
  });
  finalizeAssistantTurn({
    chatId,
    session,
    isReplayingHistory,
    sessionRuntime,
  });
}

async function persistBufferedAssistantMessage(params: {
  chatId: string;
  isReplayingHistory: boolean;
  userId?: string;
  messageId: string | null;
  shouldPersist: boolean;
  currentMessage: UIMessage | undefined;
  bufferedMessage: ReturnType<SessionBufferingPort["flush"]>;
  sessionRepo: SessionRepositoryPort;
}): Promise<void> {
  const {
    chatId,
    isReplayingHistory,
    userId,
    messageId,
    shouldPersist,
    currentMessage,
    bufferedMessage,
    sessionRepo,
  } = params;
  if (isReplayingHistory || !messageId || !shouldPersist || !userId) {
    return;
  }
  if (currentMessage) {
    finalizeStreamingParts(currentMessage);
  }
  await sessionRepo.appendMessage(chatId, userId, {
    id: messageId,
    role: "assistant",
    content: bufferedMessage?.content ?? "",
    contentBlocks: bufferedMessage?.contentBlocks ?? [],
    reasoning: bufferedMessage?.reasoning,
    reasoningBlocks: bufferedMessage?.reasoningBlocks,
    parts: currentMessage?.parts,
    timestamp: Date.now(),
  });
}

function finalizeAssistantTurn(params: {
  chatId: string;
  session: ReturnType<SessionRuntimePort["get"]>;
  isReplayingHistory: boolean;
  sessionRuntime: SessionRuntimePort;
}) {
  const { chatId, session, isReplayingHistory, sessionRuntime } = params;
  if (session?.uiState.currentAssistantId) {
    const completedId = session.uiState.currentAssistantId;
    if (!isReplayingHistory) {
      session.uiState.lastAssistantId = completedId;
      setChatFinishMessage(session, completedId, session.activeTurnId);
    }
    const current = session.uiState.messages.get(completedId);
    if (current) {
      finalizeStreamingParts(current);
      sessionRuntime.broadcast(chatId, {
        type: "ui_message",
        message: current,
      });
    }
    session.uiState.currentAssistantId = undefined;
    session.lastAssistantChunkType = undefined;
  }
  if (!session) {
    return;
  }
  session.uiState.currentUserId = undefined;
  if (isReplayingHistory) {
    return;
  }
  const broadcast = sessionRuntime.broadcast.bind(sessionRuntime);
  updateChatStatus({
    chatId,
    session,
    broadcast,
    status: "ready",
  });
  maybeBroadcastChatFinish({ chatId, session, broadcast });
}

export function isStreamingUpdate(update: SessionUpdateWithLegacy) {
  return (
    update.sessionUpdate === "agent_message_chunk" ||
    update.sessionUpdate === "agent_thought_chunk" ||
    update.sessionUpdate === "tool_call" ||
    update.sessionUpdate === "tool_call_update" ||
    update.sessionUpdate === "plan"
  );
}
