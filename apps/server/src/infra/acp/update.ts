/**
 * ACP Session Update Handler
 *
 * Handles session updates from agent processes including messages, tool calls,
 * plans, modes, and commands. Manages buffering for streaming message content
 * and persists updates to the session repository.
 *
 * @module infra/acp/update
 */

import type * as acp from "@agentclientprotocol/sdk";
import type { SessionBufferingPort } from "@/modules/session/application/ports/session-acp.port";
import type { SessionRepositoryPort } from "@/modules/session/application/ports/session-repository.port";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import {
  toStoredContentBlock,
  toStoredToolCallContent,
} from "@/shared/utils/content-block.util";
import { createId } from "@/shared/utils/id.util";
import {
  appendContentBlock,
  appendReasoningBlock,
  buildPlanToolPart,
  buildProviderMetadataFromMeta,
  buildToolPartForUpdate,
  buildToolPartFromCall,
  finalizeStreamingParts,
  getOrCreateAssistantMessage,
  getOrCreateUserMessage,
  getPlanToolCallId,
  upsertToolLocationsPart,
  upsertToolPart,
} from "@/shared/utils/ui-message.util";
import {
  maybeBroadcastChatFinish,
  setChatFinishMessage,
  updateChatStatus,
} from "@/shared/utils/chat-events.util";
import type {
  Plan,
  StoredContentBlock,
} from "../../shared/types/session.types";

function finalizeStreamingForCurrentAssistant(
  chatId: string,
  sessionRuntime: SessionRuntimePort
) {
  const session = sessionRuntime.get(chatId);
  if (!session?.uiState.currentAssistantId) {
    return;
  }
  const message = session.uiState.messages.get(
    session.uiState.currentAssistantId
  );
  if (!message) {
    return;
  }
  const hasStreaming = message.parts.some(
    (part) =>
      (part.type === "text" || part.type === "reasoning") &&
      part.state === "streaming"
  );
  if (!hasStreaming) {
    return;
  }
  finalizeStreamingParts(message);
  sessionRuntime.broadcast(chatId, { type: "ui_message", message });
}

/**
 * Type guard to check if an update is a tool call update
 *
 * @param update - The session update to check
 * @returns True if the update is a tool call update
 */
function isToolCallUpdate(
  update: SessionUpdateWithLegacy
): update is acp.ToolCallUpdate & { sessionUpdate: "tool_call_update" } {
  return update.sessionUpdate === "tool_call_update";
}

/**
 * Type guard to check if an update is a tool call creation
 *
 * @param update - The session update to check
 * @returns True if the update is a tool call creation
 */
function isToolCallCreate(
  update: SessionUpdateWithLegacy
): update is acp.ToolCall & { sessionUpdate: "tool_call" } {
  return update.sessionUpdate === "tool_call";
}

/** Legacy session update types for backward compatibility */
export interface LegacySessionUpdate {
  sessionUpdate: "turn_end" | "prompt_end";
}

/** Combined session update type including legacy updates */
export type SessionUpdateWithLegacy = acp.SessionUpdate | LegacySessionUpdate;

/**
 * Extracts text content from a content block
 *
 * @param content - The content block to extract from
 * @returns The text content or empty string for non-text blocks
 */
function contentBlockToText(content: StoredContentBlock) {
  if (content.type !== "text") {
    return "";
  }
  return content.text;
}


/**
 * Checks if an update is a replay chunk (user/agent message or thought chunks)
 *
 * @param update - The session update to check
 * @returns True if the update is a replay chunk
 */
function isReplayChunk(update: SessionUpdateWithLegacy) {
  return (
    update.sessionUpdate === "user_message_chunk" ||
    update.sessionUpdate === "agent_message_chunk" ||
    update.sessionUpdate === "agent_thought_chunk"
  );
}

/**
 * Extracts a plan from a session update
 *
 * @param update - The session update to extract from
 * @returns The extracted plan or null if not a plan update
 */
function extractPlan(update: SessionUpdateWithLegacy): Plan | null {
  if (update.sessionUpdate !== "plan") {
    return null;
  }

  return {
    _meta: "_meta" in update ? (update._meta ?? null) : null,
    entries: update.entries,
  };
}

/**
 * SessionBuffering - Buffers streaming message content for aggregation
 *
 * Accumulates content and reasoning chunks from streaming updates and
 * provides a flush method to produce complete messages.
 *
 * @example
 * ```typescript
 * const buffer = new SessionBuffering();
 * buffer.appendContent({ type: "text", text: "Hello" });
 * buffer.appendReasoning({ type: "text", text: "Let me think..." });
 * const message = buffer.flush(); // Returns complete message or null
 * ```
 */
export class SessionBuffering implements SessionBufferingPort {
  private content = "";
  private reasoning = "";
  private contentBlocks: StoredContentBlock[] = [];
  private reasoningBlocks: StoredContentBlock[] = [];
  private messageId: string | null = null;
  /** Count of replay events processed during history replay */
  replayEventCount = 0;

  /**
   * Appends content text to the buffer
   *
   * @param text - The text content to append
   */
  appendContent(block: StoredContentBlock) {
    this.appendBlock("content", block);
  }

  /**
   * Appends reasoning text to the buffer
   *
   * @param text - The reasoning text to append
   */
  appendReasoning(block: StoredContentBlock) {
    this.appendBlock("reasoning", block);
  }

  /**
   * Flushes the buffer and returns a complete message
   *
   * @returns Complete message object or null if buffer is empty
   */
  flush(): ReturnType<SessionBufferingPort["flush"]> {
    if (!this.hasContent()) {
      this.reset();
      return null;
    }

    const messageId = this.messageId ?? createId("msg");
    const content = this.content;
    const reasoning = this.reasoning || undefined;
    const contentBlocks = [...this.contentBlocks];
    const reasoningBlocks =
      this.reasoningBlocks.length > 0 ? [...this.reasoningBlocks] : undefined;
    this.reset();

    return {
      id: messageId,
      content,
      contentBlocks,
      reasoning,
      reasoningBlocks,
    };
  }

  /**
   * Checks if the buffer has any content
   *
   * @returns True if buffer has content
   */
  hasContent() {
    return this.contentBlocks.length > 0 || this.reasoningBlocks.length > 0;
  }

  /**
   * Resets the buffer to empty state
   */
  reset() {
    this.content = "";
    this.reasoning = "";
    this.contentBlocks = [];
    this.reasoningBlocks = [];
    this.messageId = null;
  }

  /**
   * Returns the current message ID if one has been assigned
   */
  getMessageId() {
    return this.messageId;
  }

  /**
   * Ensures a message ID exists and returns it
   */
  ensureMessageId(preferredId?: string) {
    if (!this.messageId) {
      this.messageId = preferredId ?? createId("msg");
    }
    return this.messageId;
  }

  /**
   * Internal method to append text to a target field
   *
   * @param target - The field to append to ("content" or "reasoning")
   * @param text - The text to append
   */
  private appendBlock(
    target: "content" | "reasoning",
    block: StoredContentBlock
  ) {
    if (target === "content") {
      this.contentBlocks.push(block);
    } else {
      this.reasoningBlocks.push(block);
    }

    const text = contentBlockToText(block);
    if (text) {
      this[target] += text;
    }

    if (!this.messageId) {
      this.messageId = createId("msg");
    }
  }
}

/**
 * Handles mode update events
 *
 * @param chatId - The session identifier
 * @param update - The session update
 * @param sessionRuntime - The session runtime port
 * @param sessionRepo - The session repository port
 * @returns True if handled, false otherwise
 */
function handleModeUpdate(
  chatId: string,
  update: SessionUpdateWithLegacy,
  sessionRuntime: SessionRuntimePort,
  sessionRepo: SessionRepositoryPort
) {
  if (update.sessionUpdate !== "current_mode_update") {
    return false;
  }

  const session = sessionRuntime.get(chatId);
  if (session?.modes) {
    session.modes.currentModeId = update.currentModeId;
  }
  sessionRepo.updateMetadata(chatId, { modeId: update.currentModeId });
  console.log(`[Server] Received mode update: ${update.currentModeId}`);
  sessionRuntime.broadcast(chatId, {
    type: "current_mode_update",
    modeId: update.currentModeId,
  });
  return true;
}

/**
 * Handles available commands update events
 *
 * @param chatId - The session identifier
 * @param update - The session update
 * @param sessionRuntime - The session runtime port
 * @param sessionRepo - The session repository port
 * @returns True if handled, false otherwise
 */
function handleCommandsUpdate(
  chatId: string,
  update: SessionUpdateWithLegacy,
  sessionRuntime: SessionRuntimePort,
  sessionRepo: SessionRepositoryPort
) {
  if (update.sessionUpdate !== "available_commands_update") {
    return false;
  }

  const session = sessionRuntime.get(chatId);
  if (session) {
    session.commands = update.availableCommands;
  }
  sessionRepo.updateMetadata(chatId, {
    commands: update.availableCommands,
  });
  console.log("[Server] Received commands update", update.availableCommands);
  sessionRuntime.broadcast(chatId, {
    type: "available_commands_update",
    availableCommands: update.availableCommands,
  });
  return true;
}

/**
 * Handles plan update events
 *
 * @param chatId - The session identifier
 * @param update - The session update
 * @param sessionRuntime - The session runtime port
 * @param sessionRepo - The session repository port
 * @returns True if handled, false otherwise
 */
function handlePlanUpdate(
  chatId: string,
  update: SessionUpdateWithLegacy,
  sessionRuntime: SessionRuntimePort,
  sessionRepo: SessionRepositoryPort
) {
  if (update.sessionUpdate !== "plan") {
    return false;
  }

  finalizeStreamingForCurrentAssistant(chatId, sessionRuntime);

  const plan = extractPlan(update);
  if (!plan) {
    return true;
  }
  const session = sessionRuntime.get(chatId);
  if (session) {
    session.plan = plan;
  }
  sessionRepo.updateMetadata(chatId, { plan });
  console.log("[Server] Received plan update", plan);
  if (session) {
    const planTool = buildPlanToolPart(plan, getPlanToolCallId(chatId));
    const { message } = upsertToolPart({
      state: session.uiState,
      part: planTool,
    });
    sessionRuntime.broadcast(chatId, { type: "ui_message", message });
  }
  return true;
}

/**
 * Handles tool call creation events
 *
 * @param chatId - The session identifier
 * @param update - The session update
 * @param sessionRuntime - The session runtime port
 * @returns True if handled, false otherwise
 */
function handleToolCallCreate(
  chatId: string,
  update: SessionUpdateWithLegacy,
  sessionRuntime: SessionRuntimePort
) {
  if (!isToolCallCreate(update)) {
    return false;
  }

  finalizeStreamingForCurrentAssistant(chatId, sessionRuntime);

  const { sessionUpdate: _sessionUpdate, ...toolCall } = update;
  const sanitizedToolCall: acp.ToolCall = {
    ...toolCall,
    content: toStoredToolCallContent(toolCall.content),
  };
  const session = sessionRuntime.get(chatId);
  if (session) {
    session.toolCalls.set(update.toolCallId, sanitizedToolCall);
  }
  if (session) {
    const toolPart = buildToolPartFromCall(sanitizedToolCall);
    const { message } = upsertToolPart({
      state: session.uiState,
      messageId: session.uiState.currentAssistantId,
      part: toolPart,
    });
    const messageWithLocations = sanitizedToolCall.locations?.length
      ? upsertToolLocationsPart({
          state: session.uiState,
          toolCallId: sanitizedToolCall.toolCallId,
          locations: sanitizedToolCall.locations,
          messageId: message.id,
        })
      : message;
    sessionRuntime.broadcast(chatId, {
      type: "ui_message",
      message: messageWithLocations ?? message,
    });
  }
  return true;
}

/**
 * Handles tool call update events (status changes, output, etc.)
 *
 * @param chatId - The session identifier
 * @param update - The session update
 * @param sessionRuntime - The session runtime port
 * @returns True if handled, false otherwise
 */
function handleToolCallUpdate(
  chatId: string,
  update: SessionUpdateWithLegacy,
  sessionRuntime: SessionRuntimePort
) {
  if (!isToolCallUpdate(update)) {
    return false;
  }

  const hasLocationsUpdate = Object.prototype.hasOwnProperty.call(
    update,
    "locations"
  );
  const sanitizedUpdate = {
    ...update,
    content: toStoredToolCallContent(update.content),
  };
  const session = sessionRuntime.get(chatId);
  const existing = session?.toolCalls.get(update.toolCallId);
  const merged = existing
    ? { ...existing }
    : ({
        toolCallId: update.toolCallId,
        title: update.title ?? "Tool Call",
      } as acp.ToolCall);

  // Merge update fields into existing tool call
  if ("title" in update && update.title) {
    merged.title = update.title;
  }
  if ("status" in update) {
    merged.status = update.status ?? undefined;
  }
  if ("kind" in update) {
    merged.kind = update.kind ?? undefined;
  }
  if ("rawInput" in update) {
    merged.rawInput = update.rawInput ?? undefined;
  }
  if ("rawOutput" in update) {
    merged.rawOutput = update.rawOutput ?? undefined;
  }
  if ("content" in update) {
    merged.content = toStoredToolCallContent(update.content) ?? undefined;
  }
  if ("locations" in update) {
    merged.locations = update.locations ?? undefined;
  }

  if (session) {
    session.toolCalls.set(update.toolCallId, merged);
  }
  if (session) {
    const toolPart = buildToolPartForUpdate({
      toolCallId: update.toolCallId,
      toolName: merged.kind ?? merged.title,
      title: merged.title ?? update.title ?? undefined,
      input: merged.rawInput,
      rawInput: merged.rawInput,
      status: merged.status ?? update.status ?? undefined,
      content:
        "content" in sanitizedUpdate
          ? sanitizedUpdate.content ?? undefined
          : merged.content,
      rawOutput: merged.rawOutput,
      meta: update._meta,
    });
    const { message } = upsertToolPart({
      state: session.uiState,
      part: toolPart,
    });
    const messageWithLocations = hasLocationsUpdate
      ? upsertToolLocationsPart({
          state: session.uiState,
          toolCallId: update.toolCallId,
          locations: update.locations ?? null,
        })
      : message;
    sessionRuntime.broadcast(chatId, {
      type: "ui_message",
      message: messageWithLocations ?? message,
    });
  }
  return true;
}

/**
 * Handles buffered message content (content/reasoning chunks and turn ends)
 *
 * @param chatId - The session identifier
 * @param buffer - The session buffering instance
 * @param isReplayingHistory - Whether replaying history
 * @param update - The session update
 * @param sessionRepo - The session repository port
 */
function handleBufferedMessage(
  chatId: string,
  buffer: SessionBufferingPort,
  isReplayingHistory: boolean,
  update: SessionUpdateWithLegacy,
  sessionRepo: SessionRepositoryPort,
  sessionRuntime: SessionRuntimePort
) {
  const session = sessionRuntime.get(chatId);
  const preferredMessageId = session?.uiState.currentAssistantId;

  // Buffer content chunks (not during replay)
  if (!isReplayingHistory) {
    if (update.sessionUpdate === "agent_message_chunk") {
      buffer.ensureMessageId(preferredMessageId);
      buffer.appendContent(toStoredContentBlock(update.content));
    }

    if (update.sessionUpdate === "agent_thought_chunk") {
      buffer.ensureMessageId(preferredMessageId);
      buffer.appendReasoning(toStoredContentBlock(update.content));
    }
  }
  const broadcast = sessionRuntime.broadcast.bind(sessionRuntime);
  const partState = isReplayingHistory ? "done" : "streaming";
  const updateProviderMetadata =
    "_meta" in update ? buildProviderMetadataFromMeta(update._meta) : undefined;
  if (session) {
    if (update.sessionUpdate === "user_message_chunk") {
      const message = getOrCreateUserMessage(session.uiState);
      appendContentBlock(
        message,
        toStoredContentBlock(update.content),
        partState,
        updateProviderMetadata
      );
      sessionRuntime.broadcast(chatId, { type: "ui_message", message });
    }

    if (
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk"
    ) {
      const nextChunkType =
        update.sessionUpdate === "agent_message_chunk"
          ? "message"
          : "reasoning";
      if (
        session.lastAssistantChunkType &&
        session.lastAssistantChunkType !== nextChunkType
      ) {
        finalizeStreamingForCurrentAssistant(chatId, sessionRuntime);
      }
      session.lastAssistantChunkType = nextChunkType;
    }

    if (update.sessionUpdate === "agent_message_chunk") {
      const messageId = buffer.ensureMessageId(preferredMessageId);
      const message = getOrCreateAssistantMessage(session.uiState, messageId);
      appendContentBlock(
        message,
        toStoredContentBlock(update.content),
        partState,
        updateProviderMetadata
      );
    }

    if (update.sessionUpdate === "agent_thought_chunk") {
      const messageId = buffer.ensureMessageId(preferredMessageId);
      const message = getOrCreateAssistantMessage(session.uiState, messageId);
      const block = toStoredContentBlock(update.content);
      if (block.type === "text") {
        appendReasoningBlock(message, block, partState, updateProviderMetadata);
        if (!isReplayingHistory) {
          sessionRuntime.broadcast(chatId, { type: "ui_message", message });
        }
      }
    }
  }

  // Flush buffer on turn end and persist message
  if (
    update.sessionUpdate === "turn_end" ||
    update.sessionUpdate === "prompt_end"
  ) {
    const bufferedMessage = buffer.flush();
    const currentAssistantId = session?.uiState.currentAssistantId;
    const messageId = bufferedMessage?.id ?? currentAssistantId ?? null;
    const currentMessage = messageId
      ? session?.uiState.messages.get(messageId)
      : undefined;
    const hasParts = Boolean(currentMessage?.parts.length);
    const shouldPersist = Boolean(bufferedMessage) || hasParts;

    if (!isReplayingHistory && messageId && shouldPersist) {
      if (currentMessage) {
        finalizeStreamingParts(currentMessage);
      }
      sessionRepo.appendMessage(chatId, {
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

    if (session?.uiState.currentAssistantId) {
      const completedId = session.uiState.currentAssistantId;
      if (!isReplayingHistory) {
        session.uiState.lastAssistantId = completedId;
        setChatFinishMessage(session, completedId);
      }
      const current = session.uiState.messages.get(completedId);
      if (current) {
        finalizeStreamingParts(current);
        sessionRuntime.broadcast(chatId, { type: "ui_message", message: current });
      }
      session.uiState.currentAssistantId = undefined;
      session.lastAssistantChunkType = undefined;
    }
    if (session) {
      session.uiState.currentUserId = undefined;
    }
    if (session && !isReplayingHistory) {
      updateChatStatus({
        chatId,
        session,
        broadcast,
        status: "ready",
      });
      maybeBroadcastChatFinish({ chatId, session, broadcast });
    }
  }
}

/**
 * Creates a session update handler for processing updates from agent processes
 *
 * @param sessionRuntime - The session runtime port for broadcasting and session access
 * @param sessionRepo - The session repository port for persistence
 * @returns Handler function for processing session updates
 *
 * @example
 * ```typescript
 * const handleUpdate = createSessionUpdateHandler(sessionRuntime, sessionRepo);
 * await handleUpdate({
 *   chatId: "session-123",
 *   buffer: new SessionBuffering(),
 *   isReplayingHistory: false,
 *   update: { sessionUpdate: "agent_message_chunk", content: {...} },
 * });
 * ```
 */
export function createSessionUpdateHandler(
  sessionRuntime: SessionRuntimePort,
  sessionRepo: SessionRepositoryPort
) {
  return function handleSessionUpdate(params: {
    chatId: string;
    buffer: SessionBufferingPort;
    isReplayingHistory: boolean;
    update: SessionUpdateWithLegacy;
  }) {
    const { chatId, buffer, isReplayingHistory, update } = params;

    // Track replay events during history replay
    if (isReplayingHistory && isReplayChunk(update)) {
      buffer.replayEventCount += 1;
    }

    const suppressReplay =
      isReplayingHistory &&
      Boolean(sessionRuntime.get(chatId)?.suppressReplayBroadcast);
    if (suppressReplay) {
      return;
    }

    if (!isReplayingHistory) {
      const isStreamingUpdate =
        update.sessionUpdate === "agent_message_chunk" ||
        update.sessionUpdate === "agent_thought_chunk" ||
        update.sessionUpdate === "tool_call" ||
        update.sessionUpdate === "tool_call_update" ||
        update.sessionUpdate === "plan";
      if (isStreamingUpdate) {
        const session = sessionRuntime.get(chatId);
        if (session?.chatStatus !== "cancelling") {
          updateChatStatus({
            chatId,
            session,
            broadcast: sessionRuntime.broadcast.bind(sessionRuntime),
            status: "streaming",
          });
        }
      }
    }

    // Handle buffered message content
    handleBufferedMessage(
      chatId,
      buffer,
      isReplayingHistory,
      update,
      sessionRepo,
      sessionRuntime
    );

    // Handle mode updates
    if (handleModeUpdate(chatId, update, sessionRuntime, sessionRepo)) {
      return;
    }

    // Handle commands updates
    if (handleCommandsUpdate(chatId, update, sessionRuntime, sessionRepo)) {
      return;
    }

    // Handle plan updates
    if (handlePlanUpdate(chatId, update, sessionRuntime, sessionRepo)) {
      return;
    }

    // Handle tool call creations
    if (handleToolCallCreate(chatId, update, sessionRuntime)) {
      return;
    }

    // Handle tool call updates
    if (handleToolCallUpdate(chatId, update, sessionRuntime)) {
      return;
    }

    // Log unknown update types (excluding common streaming chunks)
    if (update.sessionUpdate !== "agent_message_chunk") {
      console.log(
        `[Server] Received session update: ${update.sessionUpdate}`,
        JSON.stringify(update, null, 2)
      );
    }
  };
}
