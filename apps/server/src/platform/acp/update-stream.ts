import type { SessionRuntimePort } from "@/modules/session";
import { createLogger } from "@/platform/logging/structured-logger";
import type { UIMessage } from "@repo/shared";
import {
  type StoredContentContext,
  toStoredContentBlock,
} from "@/shared/utils/content-block.util";
import {
  appendContentBlock,
  appendReasoningBlock,
  buildProviderMetadataFromMeta,
  getOrCreateAssistantMessage,
  getOrCreateUserMessage,
} from "@/shared/utils/ui-message.util";
import { broadcastUiMessageDelta } from "./ui-message-delta";
import { broadcastUiMessagePart } from "./ui-message-part";
import type { SessionUpdate, SessionUpdateContext } from "./update-types";

const logger = createLogger("Debug");

/**
 * Handle ACP message/thought/user chunks by updating server-side UIMessage
 * state and emitting canonical append-only text deltas plus part snapshots.
 */
export async function handleBufferedMessage(
  context: SessionUpdateContext
): Promise<boolean> {
  return await handleUiChunkUpdate(context);
}

function appendAcceptedAgentChunkToBuffer(
  context: SessionUpdateContext,
  storedContentContext: StoredContentContext
): void {
  const { buffer, update } = context;
  if (update.sessionUpdate === "agent_message_chunk") {
    buffer.appendContent(
      toStoredContentBlock(update.content, storedContentContext)
    );
    return;
  }
  if (update.sessionUpdate === "agent_thought_chunk") {
    buffer.appendReasoning(
      toStoredContentBlock(update.content, storedContentContext)
    );
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
  const storedContentContext: StoredContentContext = {
    userId: session.userId,
    chatId,
  };

  if (
    update.sessionUpdate !== "agent_message_chunk" &&
    update.sessionUpdate !== "agent_thought_chunk" &&
    update.sessionUpdate !== "user_message_chunk"
  ) {
    return false;
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
    const block = toStoredContentBlock(update.content, storedContentContext);
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

  appendAcceptedAgentChunkToBuffer(context, storedContentContext);
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
      storedContentContext,
      updateTurnId: context.turnIdResolution.turnId ?? session.activeTurnId,
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
    storedContentContext,
    updateTurnId: context.turnIdResolution.turnId ?? session.activeTurnId,
  });
  return true;
}

async function broadcastStreamingTextLikeUpdate(params: {
  chatId: string;
  message: UIMessage;
  updatedMessage: UIMessage;
  partIndex: number;
  isNew: boolean;
  sessionRuntime: SessionUpdateContext["sessionRuntime"];
  turnId?: string;
}): Promise<void> {
  const {
    chatId,
    message,
    updatedMessage,
    partIndex,
    isNew,
    sessionRuntime,
    turnId,
  } = params;
  const nextPart = updatedMessage.parts[partIndex];
  if (!(nextPart?.type === "text" || nextPart?.type === "reasoning")) {
    return;
  }

  if (isNew) {
    await broadcastUiMessagePart({
      chatId,
      sessionRuntime,
      message: updatedMessage,
      partIndex,
      isNew: true,
      turnId,
    });
    return;
  }

  const previousPart = message.parts[partIndex];
  if (!(previousPart?.type === "text" || previousPart?.type === "reasoning")) {
    await broadcastUiMessagePart({
      chatId,
      sessionRuntime,
      message: updatedMessage,
      partIndex,
      isNew: false,
      turnId,
    });
    return;
  }

  if (
    previousPart.type !== nextPart.type ||
    !nextPart.text.startsWith(previousPart.text)
  ) {
    await broadcastUiMessagePart({
      chatId,
      sessionRuntime,
      message: updatedMessage,
      partIndex,
      isNew: false,
      turnId,
    });
    return;
  }

  const delta = nextPart.text.slice(previousPart.text.length);
  await broadcastUiMessageDelta({
    chatId,
    sessionRuntime,
    messageId: updatedMessage.id,
    partIndex,
    delta,
    turnId,
  });
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
  storedContentContext: StoredContentContext;
  updateTurnId?: string;
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
    storedContentContext,
    updateTurnId,
  } = params;

  const messageId = buffer.ensureMessageId(preferredMessageId);
  const message = getOrCreateAssistantMessage(session.uiState, messageId);
  const previousPartsLength = message.parts.length;
  const block = toStoredContentBlock(update.content, storedContentContext);
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
    return;
  }

  if (updatedMessage === message) {
    return;
  }

  if (block.type === "text") {
    const nextPartIndex = updatedMessage.parts.length - 1;
    if (nextPartIndex < 0) {
      return;
    }
    const isNew = updatedMessage.parts.length > previousPartsLength;
    await broadcastStreamingTextLikeUpdate({
      chatId,
      sessionRuntime,
      message,
      updatedMessage,
      partIndex: nextPartIndex,
      isNew,
      turnId: updateTurnId,
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
      turnId: updateTurnId,
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
  storedContentContext: StoredContentContext;
  updateTurnId?: string;
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
    storedContentContext,
    updateTurnId,
  } = params;

  const messageId = buffer.ensureMessageId(preferredMessageId);
  const message = getOrCreateAssistantMessage(session.uiState, messageId);
  const previousPartsLength = message.parts.length;
  const block = toStoredContentBlock(update.content, storedContentContext);
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
  await broadcastStreamingTextLikeUpdate({
    chatId,
    sessionRuntime,
    message,
    updatedMessage,
    partIndex: nextPartIndex,
    isNew,
    turnId: updateTurnId,
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
