import type { SessionRuntimePort } from "@/modules/session";
import { toStoredContentBlock } from "@/shared/utils/content-block.util";
import {
  appendContentBlock,
  appendReasoningBlock,
  buildProviderMetadataFromMeta,
  getOrCreateAssistantMessage,
  getOrCreateUserMessage,
} from "@/shared/utils/ui-message.util";
import type { SessionUpdate, SessionUpdateContext } from "./update-types";

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
    await sessionRuntime.broadcast(chatId, { type: "ui_message", message });
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
      await sessionRuntime.broadcast(chatId, { type: "ui_message", message });
    }
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
