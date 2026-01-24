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
import { createId } from "@/shared/utils/id.util";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "../../shared/types/ports";
import type { Plan } from "../../shared/types/session.types";

/**
 * Type guard to check if an update is a tool call update
 *
 * @param update - The session update to check
 * @returns True if the update is a tool call update
 */
function isToolCallUpdate(
  update: acp.SessionUpdate
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
  update: acp.SessionUpdate
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
function contentToText(content: acp.ContentBlock) {
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
function extractPlan(update: acp.SessionUpdate): Plan | null {
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
 * buffer.appendContent("Hello");
 * buffer.appendReasoning("Let me think...");
 * const message = buffer.flush(); // Returns complete message or null
 * ```
 */
export class SessionBuffering {
  private content = "";
  private reasoning = "";
  private messageId: string | null = null;
  /** Count of replay events processed during history replay */
  replayEventCount = 0;

  /**
   * Appends content text to the buffer
   *
   * @param text - The text content to append
   */
  appendContent(text: string) {
    this.appendText("content", text);
  }

  /**
   * Appends reasoning text to the buffer
   *
   * @param text - The reasoning text to append
   */
  appendReasoning(text: string) {
    this.appendText("reasoning", text);
  }

  /**
   * Flushes the buffer and returns a complete message
   *
   * @returns Complete message object or null if buffer is empty
   */
  flush() {
    if (!this.hasContent()) {
      this.reset();
      return null;
    }

    const messageId = this.messageId ?? createId("msg");
    const content = this.content;
    const reasoning = this.reasoning || undefined;
    this.reset();

    return { id: messageId, content, reasoning };
  }

  /**
   * Checks if the buffer has any content
   *
   * @returns True if buffer has content
   */
  hasContent() {
    return this.content.length > 0 || this.reasoning.length > 0;
  }

  /**
   * Resets the buffer to empty state
   */
  reset() {
    this.content = "";
    this.reasoning = "";
    this.messageId = null;
  }

  /**
   * Internal method to append text to a target field
   *
   * @param target - The field to append to ("content" or "reasoning")
   * @param text - The text to append
   */
  private appendText(target: "content" | "reasoning", text: string) {
    if (!text) {
      return;
    }
    this[target] += text;
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
  sessionRuntime.broadcast(chatId, { type: "session_update", update });
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
  sessionRuntime.broadcast(chatId, { type: "plan_update", plan });
  sessionRuntime.broadcast(chatId, { type: "session_update", update });
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

  const { sessionUpdate: _sessionUpdate, ...toolCall } = update;
  const session = sessionRuntime.get(chatId);
  if (session) {
    session.toolCalls.set(update.toolCallId, toolCall);
  }

  sessionRuntime.broadcast(chatId, {
    type: "tool_call",
    toolCall,
  });
  sessionRuntime.broadcast(chatId, { type: "session_update", update });
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

  const { sessionUpdate: _sessionUpdate, ...toolCallUpdate } = update;
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
    merged.content = update.content ?? undefined;
  }
  if ("locations" in update) {
    merged.locations = update.locations ?? undefined;
  }

  if (session) {
    session.toolCalls.set(update.toolCallId, merged);
  }

  sessionRuntime.broadcast(chatId, {
    type: "tool_call_update",
    toolCall: toolCallUpdate,
  });
  sessionRuntime.broadcast(chatId, { type: "session_update", update });
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
  buffer: SessionBuffering,
  isReplayingHistory: boolean,
  update: SessionUpdateWithLegacy,
  sessionRepo: SessionRepositoryPort
) {
  // Buffer content chunks (not during replay)
  if (!isReplayingHistory) {
    if (update.sessionUpdate === "agent_message_chunk") {
      const text = contentToText(update.content);
      buffer.appendContent(text);
    }

    if (update.sessionUpdate === "agent_thought_chunk") {
      buffer.appendReasoning(contentToText(update.content));
    }
  }

  // Flush buffer on turn end and persist message
  if (
    update.sessionUpdate === "turn_end" ||
    update.sessionUpdate === "prompt_end"
  ) {
    const message = buffer.flush();
    if (!isReplayingHistory && message) {
      sessionRepo.appendMessage(chatId, {
        id: message.id,
        role: "assistant",
        content: message.content,
        reasoning: message.reasoning,
        timestamp: Date.now(),
      });
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
    buffer: SessionBuffering;
    isReplayingHistory: boolean;
    update: SessionUpdateWithLegacy;
  }) {
    const { chatId, buffer, isReplayingHistory, update } = params;

    // Track replay events during history replay
    if (isReplayingHistory && isReplayChunk(update)) {
      buffer.replayEventCount += 1;
    }

    // Handle buffered message content
    handleBufferedMessage(
      chatId,
      buffer,
      isReplayingHistory,
      update,
      sessionRepo
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

    // Broadcast generic session update
    sessionRuntime.broadcast(chatId, { type: "session_update", update });
  };
}
