import type { UIMessage } from "@repo/shared";
import type { SessionRuntimePort } from "@/modules/session";
import { createLogger } from "@/platform/logging/structured-logger";
import type { StoredMessage } from "@/shared/types/session.types";
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
import { broadcastUiMessagePart } from "./ui-message-part";
import type { SessionUpdate, SessionUpdateContext } from "./update-types";

const logger = createLogger("Debug");
const COMPLETED_TURN_LATE_CHUNK_GRACE_MS = 2500;

/**
 * Handle ACP message/thought/user chunks by updating server-side UIMessage
 * state and emitting canonical part snapshots for the web/native clients.
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: UI chunk update requires complex state management
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
    await finalizeStreamingForCurrentAssistant(chatId, sessionRuntime, buffer, {
      suppressBroadcast: suppressReplayBroadcast,
    });
    // A new user chunk indicates the next conversation turn. Reset assistant
    // streaming pointers so replay/live updates do not merge distinct answers.
    session.uiState.currentAssistantId = undefined;
    session.uiState.requiresTurnIdForNextAssistantChunk = isReplayingHistory
      ? undefined
      : true;
    session.lastAssistantChunkType = undefined;
    buffer.reset();
    if (session.uiState.currentUserSource !== "acp") {
      session.uiState.currentUserId = undefined;
    }
    session.uiState.currentUserSource = "acp";

    const message = getOrCreateUserMessage(session.uiState);
    const block = toStoredContentBlock(update.content, storedContentContext);
    const partState = "done";
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

  if (
    !isReplayingHistory &&
    session.uiState.requiresTurnIdForNextAssistantChunk &&
    !context.turnIdResolution.turnId
  ) {
    logger.warn(
      "Ignoring assistant chunk after ACP user boundary without turnId",
      {
        chatId,
        sessionUpdate: update.sessionUpdate,
      }
    );
    return true;
  }
  if (context.turnIdResolution.turnId) {
    session.uiState.requiresTurnIdForNextAssistantChunk = undefined;
  }

  appendAcceptedAgentChunkToBuffer(context, storedContentContext);
  const recentCompletedTurn = resolveRecentCompletedTurnForLateChunk(session);
  const updateTurnId =
    context.turnIdResolution.turnId ??
    session.activeTurnId ??
    recentCompletedTurn?.turnId;
  if (
    !(context.turnIdResolution.turnId || session.activeTurnId) &&
    recentCompletedTurn
  ) {
    logger.debug("Recovered missing turnId for late assistant chunk", {
      chatId,
      recoveredTurnId: recentCompletedTurn.turnId,
      ageMs: recentCompletedTurn.ageMs,
      graceMs: COMPLETED_TURN_LATE_CHUNK_GRACE_MS,
      sessionUpdate: update.sessionUpdate,
    });
  }
  const shouldPreferLastAssistantId =
    !session.activeTurnId &&
    Boolean(updateTurnId) &&
    session.lastCompletedTurnId === updateTurnId;
  const preferredMessageId =
    session.uiState.currentAssistantId ??
    (shouldPreferLastAssistantId ? session.uiState.lastAssistantId : undefined);
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
  session.lastAssistantActivityAtMs = Date.now();
  if (updateTurnId) {
    session.lastAssistantActivityTurnId = updateTurnId;
  }

  if (update.sessionUpdate === "agent_thought_chunk") {
    appendAssistantReasoningChunk({
      session,
      buffer,
      preferredMessageId,
      update,
      partState,
      providerMetadata,
      storedContentContext,
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
    sessionRepo: context.sessionRepo,
    storedContentContext,
    updateTurnId,
  });
  return true;
}

function resolveRecentCompletedTurnForLateChunk(
  session: NonNullable<ReturnType<SessionRuntimePort["get"]>>
): { turnId: string; ageMs: number } | undefined {
  if (session.activeTurnId) {
    return undefined;
  }
  const turnId = session.lastCompletedTurnId;
  const completedAtMs = session.lastCompletedTurnAtMs;
  if (!(turnId && typeof completedAtMs === "number")) {
    return undefined;
  }
  const ageMs = Date.now() - completedAtMs;
  if (ageMs > COMPLETED_TURN_LATE_CHUNK_GRACE_MS) {
    return undefined;
  }
  return {
    turnId,
    ageMs,
  };
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
  sessionRepo: SessionUpdateContext["sessionRepo"];
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
    sessionRepo,
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
    // Normal streaming text snapshots are deferred until finalize/transition.
    // But late chunks for a recently completed turn must be emitted
    // immediately so the client does not lose the trailing tail.
    const isLateChunkForCompletedTurn =
      !session.activeTurnId &&
      Boolean(updateTurnId) &&
      session.lastCompletedTurnId === updateTurnId;
    if (isLateChunkForCompletedTurn) {
      const partIndex = updatedMessage.parts.length - 1;
      const isNew = updatedMessage.parts.length > previousPartsLength;
      if (partIndex >= 0) {
        await broadcastUiMessagePart({
          chatId,
          sessionRuntime,
          message: updatedMessage,
          partIndex,
          isNew,
          turnId: updateTurnId,
        });
      }
      await persistAssistantMessageSnapshot({
        chatId,
        userId: session.userId,
        message: updatedMessage,
        sessionRepo,
      });
    }
    return;
  }

  if (updatedMessage.parts.length <= previousPartsLength) {
    return;
  }

  const nextPartIndexes: number[] = [];
  for (
    let index = previousPartsLength;
    index < updatedMessage.parts.length;
    index += 1
  ) {
    nextPartIndexes.push(index);
  }
  await Promise.all(
    nextPartIndexes.map((partIndex) =>
      broadcastUiMessagePart({
        chatId,
        sessionRuntime,
        message: updatedMessage,
        partIndex,
        isNew: true,
        turnId: updateTurnId,
      })
    )
  );
}

function appendAssistantReasoningChunk(params: {
  session: NonNullable<ReturnType<SessionRuntimePort["get"]>>;
  buffer: SessionUpdateContext["buffer"];
  preferredMessageId: string | undefined;
  update: Extract<SessionUpdate, { sessionUpdate: "agent_thought_chunk" }>;
  partState: "streaming" | "done";
  providerMetadata:
    | ReturnType<typeof buildProviderMetadataFromMeta>
    | undefined;
  storedContentContext: StoredContentContext;
}): void {
  const {
    session,
    buffer,
    preferredMessageId,
    update,
    partState,
    providerMetadata,
    storedContentContext,
  } = params;

  const messageId = buffer.ensureMessageId(preferredMessageId);
  const message = getOrCreateAssistantMessage(session.uiState, messageId);
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

function extractTextBlocks(
  message: UIMessage,
  partType: "text" | "reasoning"
): Array<{ type: "text"; text: string }> {
  const blocks: Array<{ type: "text"; text: string }> = [];
  for (const part of message.parts) {
    if (part.type !== partType) {
      continue;
    }
    blocks.push({
      type: "text",
      text: part.text,
    });
  }
  return blocks;
}

function toStoredMessageSnapshot(message: UIMessage): StoredMessage | null {
  if (message.role !== "assistant") {
    return null;
  }
  const contentBlocks = extractTextBlocks(message, "text");
  const reasoningBlocks = extractTextBlocks(message, "reasoning");
  const content = contentBlocks.map((block) => block.text).join("");
  const reasoning = reasoningBlocks.map((block) => block.text).join("");
  const timestamp =
    typeof message.createdAt === "number" && Number.isFinite(message.createdAt)
      ? Math.trunc(message.createdAt)
      : Date.now();
  return {
    id: message.id,
    role: "assistant",
    content,
    timestamp,
    parts: message.parts,
    ...(contentBlocks.length > 0 ? { contentBlocks } : {}),
    ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
    ...(reasoning.length > 0 ? { reasoning } : {}),
  };
}

async function persistAssistantMessageSnapshot(params: {
  chatId: string;
  userId: string;
  message: UIMessage;
  sessionRepo: SessionUpdateContext["sessionRepo"];
}): Promise<void> {
  const storedMessage = toStoredMessageSnapshot(params.message);
  if (!storedMessage) {
    return;
  }
  try {
    await params.sessionRepo.appendMessage(
      params.chatId,
      params.userId,
      storedMessage
    );
    logger.debug("Persisted late assistant chunk snapshot", {
      chatId: params.chatId,
      messageId: params.message.id,
      contentLength: storedMessage.content.length,
      partsCount: params.message.parts.length,
    });
  } catch (error) {
    logger.warn("Failed to persist late assistant chunk snapshot", {
      chatId: params.chatId,
      messageId: params.message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
