import type { SessionRuntimePort } from "@/modules/session";
import { shouldEmitRuntimeLog } from "@/platform/logging/runtime-log-level";
import { createLogger } from "@/platform/logging/structured-logger";
import { toStoredContentBlock } from "@/shared/utils/content-block.util";
import { escapeHtmlText } from "@/shared/utils/html.util";
import {
  appendContentBlock,
  buildProviderMetadataFromMeta,
  getOrCreateAssistantMessage,
  getOrCreateUserMessage,
} from "@/shared/utils/ui-message.util";
import { broadcastUiMessagePart } from "./ui-message-part";
import type { SessionUpdate, SessionUpdateContext } from "./update-types";

const logger = createLogger("Debug");

type SuppressReason = "replay_suppressed";

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

  if (update.sessionUpdate === "agent_thought_chunk") {
    return true;
  }

  const partState = isReplayingHistory ? "done" : "streaming";
  const providerMetadata = buildProviderMetadataFromMeta(
    "_meta" in update ? update._meta : undefined
  );
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
    const nextPartIndex = updatedMessage.parts.length - 1;
    const nextPart = updatedMessage.parts[nextPartIndex];
    const appendedNewPart = updatedMessage.parts.length > previousPartsLength;

    if (appendedNewPart || nextPart?.type !== "text") {
      await broadcastUiMessagePart({
        chatId,
        sessionRuntime,
        message: updatedMessage,
        partIndex: nextPartIndex,
        isNew: true,
      });
      return;
    }

    const escapedDelta = escapeHtmlText(block.text);
    if (escapedDelta.length > 0) {
      logDeltaDecision({
        chatId,
        messageId,
        partIndex: nextPartIndex,
        deltaLength: escapedDelta.length,
      });
      await sessionRuntime.broadcast(
        chatId,
        {
          type: "ui_message_delta",
          messageId,
          partIndex: nextPartIndex,
          delta: escapedDelta,
        },
        {
          durable: false,
          retainInBuffer: false,
        }
      );
      return;
    }

    await broadcastUiMessagePart({
      chatId,
      sessionRuntime,
      message: updatedMessage,
      partIndex: nextPartIndex,
      isNew: false,
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

function logDeltaDecision(params: {
  chatId: string;
  messageId: string;
  partIndex: number;
  deltaLength: number;
}): void {
  if (!shouldEmitRuntimeLog("debug")) {
    return;
  }
  logger.debug("ACP ui delta emitted", {
    chatId: params.chatId,
    messageId: params.messageId,
    partIndex: params.partIndex,
    deltaLength: params.deltaLength,
  });
}

function logSuppressedChunk(params: {
  chatId: string;
  messageId: string;
  chunkType: "message";
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
