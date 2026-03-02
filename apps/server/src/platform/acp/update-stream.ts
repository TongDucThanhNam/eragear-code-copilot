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
  appendAgentChunksToBuffer(context);
  return await handleUiChunkUpdate(context);
}

function appendAgentChunksToBuffer(context: SessionUpdateContext): void {
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

  if (update.sessionUpdate === "user_message_chunk") {
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
    // This keeps streaming UX in sync with terminal output while preserving
    // canonical server-side part assembly.
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
