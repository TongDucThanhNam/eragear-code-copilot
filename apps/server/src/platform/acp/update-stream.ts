import type { SessionRuntimePort } from "@/modules/session";
import { shouldEmitRuntimeLog } from "@/platform/logging/runtime-log-level";
import { createLogger } from "@/platform/logging/structured-logger";
import { toStoredContentBlock } from "@/shared/utils/content-block.util";
import {
  appendContentBlock,
  appendReasoningBlock,
  buildProviderMetadataFromMeta,
  getOrCreateAssistantMessage,
  getOrCreateUserMessage,
} from "@/shared/utils/ui-message.util";
import { broadcastUiMessagePart } from "./ui-message-part";
import type { SessionUpdate, SessionUpdateContext } from "./update-types";

const logger = createLogger("Debug");

type SuppressReason = "replay_suppressed";

/**
 * Handle ACP message/thought/user chunks by updating server-side UIMessage
 * state and emitting canonical part-level stream snapshots.
 */
export async function handleBufferedMessage(
  context: SessionUpdateContext
): Promise<boolean> {
  return await handleUiChunkUpdate(context);
}

const TURN_ID_MAX_LENGTH = 128;
const TURN_ID_PATTERN = /^[^\s\u0000-\u001F\u007F]+$/;

function sanitizeTurnId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > TURN_ID_MAX_LENGTH ||
    !TURN_ID_PATTERN.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

function readTurnIdFromMeta(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const record = meta as Record<string, unknown>;
  const direct =
    sanitizeTurnId(record.turnId) ??
    sanitizeTurnId(record.turn_id) ??
    sanitizeTurnId(record["turn-id"]);
  if (direct) {
    return direct;
  }
  if (record.turn && typeof record.turn === "object") {
    const turnRecord = record.turn as Record<string, unknown>;
    return sanitizeTurnId(turnRecord.id);
  }
  return undefined;
}

function readUpdateTurnId(update: SessionUpdate): string | undefined {
  const asRecord = update as unknown as Record<string, unknown>;
  return sanitizeTurnId(asRecord.turnId) ?? readTurnIdFromMeta(asRecord._meta);
}

function appendAcceptedAgentChunkToBuffer(context: SessionUpdateContext): void {
  const { buffer, update } = context;
  if (update.sessionUpdate === "agent_message_chunk") {
    buffer.appendContent(toStoredContentBlock(update.content));
    return;
  }
  if (update.sessionUpdate === "agent_thought_chunk") {
    buffer.appendReasoning(toStoredContentBlock(update.content));
  }
}

async function handleUiChunkUpdate(
  context: SessionUpdateContext
): Promise<boolean> {
  const {
    chatId,
    buffer,
    isReplayingHistory,
    suppressReplayBroadcast,
    update,
    sessionRuntime,
    finalizeStreamingForCurrentAssistant,
  } = context;
  const session = sessionRuntime.get(chatId);
  if (!session) {
    return false;
  }

  if (
    update.sessionUpdate !== "agent_message_chunk" &&
    update.sessionUpdate !== "agent_thought_chunk" &&
    update.sessionUpdate !== "user_message_chunk"
  ) {
    return false;
  }

  const updateTurnId = readUpdateTurnId(update);
  if (!isReplayingHistory && updateTurnId && session.activeTurnId) {
    if (updateTurnId !== session.activeTurnId) {
      logger.warn("Ignoring stale ACP chunk with mismatched turnId", {
        chatId,
        updateType: update.sessionUpdate,
        updateTurnId,
        activeTurnId: session.activeTurnId,
      });
      return false;
    }
  }

  if (update.sessionUpdate === "user_message_chunk") {
    if (!isReplayingHistory) {
      // Canonical live user input is emitted by SendMessageService. Ignore
      // provider-origin user chunks in live mode to avoid cross-turn resets.
      logger.warn("Ignoring live user_message_chunk outside replay", {
        chatId,
      });
      return false;
    }
    await finalizeStreamingForCurrentAssistant(chatId, sessionRuntime, buffer, {
      suppressBroadcast: suppressReplayBroadcast,
    });
    // A new user chunk indicates the next conversation turn. Reset assistant
    // streaming pointers so replay/live updates do not merge distinct answers.
    session.uiState.currentAssistantId = undefined;
    session.lastAssistantChunkType = undefined;
    buffer.reset();

    const message = getOrCreateUserMessage(session.uiState);
    const block = toStoredContentBlock(update.content);
    const partState = isReplayingHistory ? "done" : "streaming";
    const providerMetadata = buildProviderMetadataFromMeta(
      "_meta" in update ? update._meta : undefined
    );
    const updatedMessage = appendContentBlock(
      message,
      block,
      partState,
      providerMetadata
    );
    if (updatedMessage !== message) {
      session.uiState.messages.set(updatedMessage.id, updatedMessage);
    }
    if (!suppressReplayBroadcast) {
      await sessionRuntime.broadcast(chatId, {
        type: "ui_message",
        message: updatedMessage,
      });
    }
    return true;
  }

  appendAcceptedAgentChunkToBuffer(context);
  const preferredMessageId = session.uiState.currentAssistantId;
  await updateAssistantChunkType({
    chatId,
    session,
    buffer,
    update,
    sessionRuntime,
    finalizeStreamingForCurrentAssistant,
  });

  const partState = isReplayingHistory ? "done" : "streaming";
  const providerMetadata = buildProviderMetadataFromMeta(
    "_meta" in update ? update._meta : undefined
  );

  if (update.sessionUpdate === "agent_thought_chunk") {
    await appendAssistantReasoningChunk({
      chatId,
      session,
      buffer,
      preferredMessageId,
      suppressReplayBroadcast,
      update,
      partState,
      providerMetadata,
      sessionRuntime,
    });
    // Prevent duplicate reasoning append when chunk type transitions/finalizes.
    buffer.consumePendingReasoning();
    return true;
  }

  await appendAssistantChunk({
    chatId,
    session,
    buffer,
    preferredMessageId,
    suppressReplayBroadcast,
    update,
    partState,
    providerMetadata,
    sessionRuntime,
  });
  return true;
}

async function appendAssistantChunk(params: {
  chatId: string;
  session: NonNullable<ReturnType<SessionRuntimePort["get"]>>;
  buffer: SessionUpdateContext["buffer"];
  preferredMessageId: string | undefined;
  suppressReplayBroadcast: boolean;
  update: Extract<SessionUpdate, { sessionUpdate: "agent_message_chunk" }>;
  partState: "streaming" | "done";
  providerMetadata:
    | ReturnType<typeof buildProviderMetadataFromMeta>
    | undefined;
  sessionRuntime: SessionUpdateContext["sessionRuntime"];
}): Promise<void> {
  const {
    chatId,
    session,
    buffer,
    preferredMessageId,
    suppressReplayBroadcast,
    update,
    partState,
    providerMetadata,
    sessionRuntime,
  } = params;

  const messageId = buffer.ensureMessageId(preferredMessageId);
  const message = getOrCreateAssistantMessage(session.uiState, messageId);
  const previousPartsLength = message.parts.length;
  const block = toStoredContentBlock(update.content);
  const updatedMessage = appendContentBlock(
    message,
    block,
    partState,
    providerMetadata
  );
  if (updatedMessage !== message) {
    session.uiState.messages.set(updatedMessage.id, updatedMessage);
  }

  if (suppressReplayBroadcast) {
    logSuppressedChunk({
      chatId,
      messageId,
      chunkType: "message",
      suppressReason: "replay_suppressed",
    });
    return;
  }

  if (updatedMessage === message) {
    return;
  }

  if (block.type === "text") {
    // Broadcast full text-part snapshots on every chunk (without delta).
    // Throttled to coalesce rapid ACP chunks into fewer WebSocket messages
    // while keeping streaming UX responsive (~80 ms latency ceiling).
    const nextPartIndex = updatedMessage.parts.length - 1;
    if (nextPartIndex < 0) {
      return;
    }
    const isNew = updatedMessage.parts.length > previousPartsLength;
    await broadcastUiMessagePart({
      chatId,
      sessionRuntime,
      message: updatedMessage,
      partIndex: nextPartIndex,
      isNew,
      immediate: false,
    });
    return;
  }

  if (updatedMessage.parts.length <= previousPartsLength) {
    return;
  }

  for (
    let index = previousPartsLength;
    index < updatedMessage.parts.length;
    index += 1
  ) {
    await broadcastUiMessagePart({
      chatId,
      sessionRuntime,
      message: updatedMessage,
      partIndex: index,
      isNew: true,
    });
  }
}

async function appendAssistantReasoningChunk(params: {
  chatId: string;
  session: NonNullable<ReturnType<SessionRuntimePort["get"]>>;
  buffer: SessionUpdateContext["buffer"];
  preferredMessageId: string | undefined;
  suppressReplayBroadcast: boolean;
  update: Extract<SessionUpdate, { sessionUpdate: "agent_thought_chunk" }>;
  partState: "streaming" | "done";
  providerMetadata:
    | ReturnType<typeof buildProviderMetadataFromMeta>
    | undefined;
  sessionRuntime: SessionUpdateContext["sessionRuntime"];
}): Promise<void> {
  const {
    chatId,
    session,
    buffer,
    preferredMessageId,
    suppressReplayBroadcast,
    update,
    partState,
    providerMetadata,
    sessionRuntime,
  } = params;

  const messageId = buffer.ensureMessageId(preferredMessageId);
  const message = getOrCreateAssistantMessage(session.uiState, messageId);
  const previousPartsLength = message.parts.length;
  const block = toStoredContentBlock(update.content);
  const updatedMessage = appendReasoningBlock(
    message,
    block,
    partState,
    providerMetadata
  );
  if (updatedMessage !== message) {
    session.uiState.messages.set(updatedMessage.id, updatedMessage);
  }

  if (suppressReplayBroadcast) {
    logSuppressedChunk({
      chatId,
      messageId,
      chunkType: "reasoning",
      suppressReason: "replay_suppressed",
    });
    return;
  }

  if (updatedMessage === message) {
    return;
  }

  const nextPartIndex = updatedMessage.parts.length - 1;
  if (nextPartIndex < 0) {
    return;
  }
  const isNew = updatedMessage.parts.length > previousPartsLength;
  await broadcastUiMessagePart({
    chatId,
    sessionRuntime,
    message: updatedMessage,
    partIndex: nextPartIndex,
    isNew,
    immediate: false,
  });
}

async function updateAssistantChunkType(params: {
  chatId: string;
  session: NonNullable<ReturnType<SessionRuntimePort["get"]>>;
  buffer: SessionUpdateContext["buffer"];
  update: Extract<
    SessionUpdate,
    { sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" }
  >;
  sessionRuntime: SessionUpdateContext["sessionRuntime"];
  finalizeStreamingForCurrentAssistant: SessionUpdateContext["finalizeStreamingForCurrentAssistant"];
}): Promise<void> {
  const {
    chatId,
    session,
    buffer,
    update,
    sessionRuntime,
    finalizeStreamingForCurrentAssistant,
  } = params;
  const nextChunkType =
    update.sessionUpdate === "agent_message_chunk" ? "message" : "reasoning";
  if (
    session.lastAssistantChunkType &&
    session.lastAssistantChunkType !== nextChunkType
  ) {
    // Log aggregated content stats before transitioning chunk type
    if (session.lastAssistantChunkType === "message") {
      const stats = buffer.getContentStats();
      if (stats.contentChunkCount > 0) {
        logger.info("ACP text part complete", {
          chatId,
          totalChunks: stats.contentChunkCount,
          totalChars: stats.contentTextLength,
          durationMs: stats.contentDurationMs,
        });
        buffer.resetContentStats();
      }
    }
    await finalizeStreamingForCurrentAssistant(chatId, sessionRuntime, buffer);
  }
  session.lastAssistantChunkType = nextChunkType;
}

export function isStreamingUpdate(update: SessionUpdate) {
  return (
    update.sessionUpdate === "agent_message_chunk" ||
    update.sessionUpdate === "agent_thought_chunk" ||
    update.sessionUpdate === "tool_call" ||
    update.sessionUpdate === "tool_call_update" ||
    update.sessionUpdate === "plan"
  );
}

function logSuppressedChunk(params: {
  chatId: string;
  messageId: string;
  chunkType: "message" | "reasoning";
  suppressReason: SuppressReason;
}): void {
  if (!shouldEmitRuntimeLog("debug")) {
    return;
  }
  logger.debug("ACP ui chunk broadcast suppressed", {
    chatId: params.chatId,
    messageId: params.messageId,
    chunkType: params.chunkType,
    reason: params.suppressReason,
  });
}
