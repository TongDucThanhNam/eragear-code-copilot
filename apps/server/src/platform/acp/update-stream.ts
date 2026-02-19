import type { UIMessage } from "@repo/shared";
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
import type { SessionUpdate, SessionUpdateContext } from "./update-types";

const logger = createLogger("Debug");
const DELTA_SNAPSHOT_INTERVAL = 20;
export const STREAM_DELTA_SNAPSHOT_INTERVAL = DELTA_SNAPSHOT_INTERVAL;

type DeltaPartType = "text" | "reasoning";
type SnapshotReason =
  | "replay_chunk"
  | "non_text_block"
  | "first_part"
  | "part_state_transition"
  | "periodic_anchor";
type SuppressReason = "replay_suppressed";

interface SnapshotDecision {
  shouldBroadcastSnapshot: boolean;
  reason?: SnapshotReason;
}

const deltaCountsByMessage = new WeakMap<
  UIMessage,
  { text: number; reasoning: number }
>();

export async function handleBufferedMessage(
  context: SessionUpdateContext
): Promise<void> {
  appendAgentChunksToBuffer(context);
  await handleUiChunkUpdate(context);
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
): Promise<void> {
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
    return;
  }

  if (
    update.sessionUpdate !== "agent_message_chunk" &&
    update.sessionUpdate !== "agent_thought_chunk" &&
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
    if (!suppressReplayBroadcast) {
      await sessionRuntime.broadcast(chatId, { type: "ui_message", message });
    }
    return;
  }

  const partState = isReplayingHistory ? "done" : "streaming";
  const providerMetadata = buildProviderMetadataFromMeta(
    "_meta" in update ? update._meta : undefined
  );
  const preferredMessageId = session.uiState.currentAssistantId;

  await updateAssistantChunkType({
    chatId,
    session,
    update,
    sessionRuntime,
    finalizeStreamingForCurrentAssistant,
  });
  await appendAssistantChunk({
    chatId,
    session,
    buffer,
    preferredMessageId,
    isReplayingHistory,
    suppressReplayBroadcast,
    update,
    partState,
    providerMetadata,
    sessionRuntime,
  });
}

async function appendAssistantChunk(params: {
  chatId: string;
  session: NonNullable<ReturnType<SessionRuntimePort["get"]>>;
  buffer: SessionUpdateContext["buffer"];
  preferredMessageId: string | undefined;
  isReplayingHistory: boolean;
  suppressReplayBroadcast: boolean;
  update: Extract<
    SessionUpdate,
    { sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" }
  >;
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
    isReplayingHistory,
    suppressReplayBroadcast,
    update,
    partState,
    providerMetadata,
    sessionRuntime,
  } = params;
  if (update.sessionUpdate === "agent_message_chunk") {
    const messageId = buffer.ensureMessageId(preferredMessageId);
    const message = getOrCreateAssistantMessage(session.uiState, messageId);
    const block = toStoredContentBlock(update.content);
    const snapshotDecision = decideSnapshotBroadcast({
      message,
      isReplayingHistory,
      partState,
      chunkType: "message",
      blockType: block.type,
    });
    appendContentBlock(message, block, partState, providerMetadata);

    if (!suppressReplayBroadcast) {
      if (snapshotDecision.shouldBroadcastSnapshot) {
        resetDeltaCount(message, "text");
        logSnapshotDecision({
          chatId,
          isReplayingHistory,
          messageId,
          chunkType: "message",
          reason: snapshotDecision.reason,
        });
        await sessionRuntime.broadcast(chatId, { type: "ui_message", message });
      } else if (block.type === "text" && block.text.length > 0) {
        const deltaCount = incrementDeltaCount(message, "text");
        logDeltaDecision({
          chatId,
          messageId,
          partType: "text",
          deltaLength: block.text.length,
          deltaCount,
        });
        await sessionRuntime.broadcast(
          chatId,
          {
            type: "ui_message_delta",
            messageId,
            partType: "text",
            delta: block.text,
          },
          {
            durable: false,
            retainInBuffer: false,
          }
        );
      }
    } else {
      logSuppressedChunk({
        chatId,
        messageId,
        chunkType: "message",
        suppressReason: "replay_suppressed",
      });
    }
    return;
  }

  const messageId = buffer.ensureMessageId(preferredMessageId);
  const message = getOrCreateAssistantMessage(session.uiState, messageId);
  const block = toStoredContentBlock(update.content);
  if (block.type !== "text") {
    return;
  }
  const snapshotDecision = decideSnapshotBroadcast({
    message,
    isReplayingHistory,
    partState,
    chunkType: "reasoning",
    blockType: block.type,
  });
  appendReasoningBlock(message, block, partState, providerMetadata);
  if (suppressReplayBroadcast) {
    logSuppressedChunk({
      chatId,
      messageId,
      chunkType: "reasoning",
      suppressReason: "replay_suppressed",
    });
    return;
  }
  if (snapshotDecision.shouldBroadcastSnapshot) {
    resetDeltaCount(message, "reasoning");
    logSnapshotDecision({
      chatId,
      isReplayingHistory,
      messageId,
      chunkType: "reasoning",
      reason: snapshotDecision.reason,
    });
    await sessionRuntime.broadcast(chatId, { type: "ui_message", message });
    return;
  }
  if (block.text.length > 0) {
    const deltaCount = incrementDeltaCount(message, "reasoning");
    logDeltaDecision({
      chatId,
      messageId,
      partType: "reasoning",
      deltaLength: block.text.length,
      deltaCount,
    });
    await sessionRuntime.broadcast(
      chatId,
      {
        type: "ui_message_delta",
        messageId,
        partType: "reasoning",
        delta: block.text,
      },
      {
        durable: false,
        retainInBuffer: false,
      }
    );
  }
}

async function updateAssistantChunkType(params: {
  chatId: string;
  session: NonNullable<ReturnType<SessionRuntimePort["get"]>>;
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
    await finalizeStreamingForCurrentAssistant(chatId, sessionRuntime);
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

function decideSnapshotBroadcast(params: {
  isReplayingHistory: boolean;
  message: ReturnType<typeof getOrCreateAssistantMessage>;
  partState: "streaming" | "done";
  chunkType: "message" | "reasoning";
  blockType: ReturnType<typeof toStoredContentBlock>["type"];
}): SnapshotDecision {
  const { isReplayingHistory, message, partState, chunkType, blockType } =
    params;
  if (isReplayingHistory) {
    return { shouldBroadcastSnapshot: true, reason: "replay_chunk" };
  }
  if (blockType !== "text") {
    return { shouldBroadcastSnapshot: true, reason: "non_text_block" };
  }

  const lastPart = message.parts.at(-1);
  if (chunkType === "message") {
    if (lastPart?.type !== "text") {
      return { shouldBroadcastSnapshot: true, reason: "first_part" };
    }
    if (lastPart.state !== partState) {
      return {
        shouldBroadcastSnapshot: true,
        reason: "part_state_transition",
      };
    }
    if (nextDeltaCount(message, "text") >= DELTA_SNAPSHOT_INTERVAL) {
      return { shouldBroadcastSnapshot: true, reason: "periodic_anchor" };
    }
    return { shouldBroadcastSnapshot: false };
  }

  if (lastPart?.type !== "reasoning") {
    return { shouldBroadcastSnapshot: true, reason: "first_part" };
  }
  if (lastPart.state !== partState) {
    return {
      shouldBroadcastSnapshot: true,
      reason: "part_state_transition",
    };
  }
  if (nextDeltaCount(message, "reasoning") >= DELTA_SNAPSHOT_INTERVAL) {
    return { shouldBroadcastSnapshot: true, reason: "periodic_anchor" };
  }
  return { shouldBroadcastSnapshot: false };
}

function nextDeltaCount(message: UIMessage, partType: DeltaPartType): number {
  const current = deltaCountsByMessage.get(message);
  const count = current?.[partType] ?? 0;
  return count + 1;
}

function incrementDeltaCount(
  message: UIMessage,
  partType: DeltaPartType
): number {
  const current = deltaCountsByMessage.get(message);
  if (current) {
    current[partType] += 1;
    return current[partType];
  }
  const initialState = {
    text: partType === "text" ? 1 : 0,
    reasoning: partType === "reasoning" ? 1 : 0,
  };
  deltaCountsByMessage.set(message, initialState);
  return initialState[partType];
}

function resetDeltaCount(message: UIMessage, partType: DeltaPartType): void {
  const current = deltaCountsByMessage.get(message);
  if (current) {
    current[partType] = 0;
    return;
  }
  deltaCountsByMessage.set(message, {
    text: 0,
    reasoning: 0,
  });
}

function logSnapshotDecision(params: {
  chatId: string;
  isReplayingHistory: boolean;
  messageId: string;
  chunkType: "message" | "reasoning";
  reason?: SnapshotReason;
}): void {
  if (!shouldEmitRuntimeLog("debug")) {
    return;
  }
  logger.debug("ACP ui snapshot emitted", {
    chatId: params.chatId,
    messageId: params.messageId,
    chunkType: params.chunkType,
    isReplayingHistory: params.isReplayingHistory,
    reason: params.reason ?? "unknown",
  });
}

function logDeltaDecision(params: {
  chatId: string;
  messageId: string;
  partType: DeltaPartType;
  deltaLength: number;
  deltaCount: number;
}): void {
  if (!shouldEmitRuntimeLog("debug")) {
    return;
  }
  logger.debug("ACP ui delta emitted", {
    chatId: params.chatId,
    messageId: params.messageId,
    partType: params.partType,
    deltaLength: params.deltaLength,
    deltaCount: params.deltaCount,
  });
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
