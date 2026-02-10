/**
 * ACP Session Update Handler
 *
 * Orchestrates session updates from agent processes while delegating
 * streaming, plan, and tool-call logic to focused handlers.
 *
 * @module infra/acp/update
 */

import type {
  SessionBufferingPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { createLogger } from "@/platform/logging/structured-logger";
import { updateChatStatus } from "@/shared/utils/chat-events.util";
import { finalizeStreamingParts } from "@/shared/utils/ui-message.util";
import { SessionBuffering as SessionBufferingImpl } from "./update-buffer";
import { handlePlanUpdate } from "./update-plan";
import { handleBufferedMessage, isStreamingUpdate } from "./update-stream";
import { handleToolCallCreate, handleToolCallUpdate } from "./update-tool";
import type { SessionUpdateWithLegacy } from "./update-types";
import { isReplayChunk } from "./update-types";

export const SessionBuffering = SessionBufferingImpl;

const logger = createLogger("Debug");

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

function summarizeUpdate(update: SessionUpdateWithLegacy) {
  const summary: Record<string, unknown> = {
    sessionUpdate: update.sessionUpdate,
  };
  if ("_meta" in update) {
    summary.hasMeta = Boolean(update._meta);
  }
  if ("toolCallId" in update) {
    summary.toolCallId = update.toolCallId;
  }
  if ("currentModeId" in update) {
    summary.currentModeId = update.currentModeId;
  }
  if (
    "availableCommands" in update &&
    Array.isArray(update.availableCommands)
  ) {
    summary.availableCommandsCount = update.availableCommands.length;
  }
  if ("entries" in update && Array.isArray(update.entries)) {
    summary.planEntries = update.entries.length;
  }
  if ("content" in update) {
    const content = (update as { content?: unknown }).content;
    if (Array.isArray(content)) {
      summary.contentLength = content.length;
    } else if (content && typeof content === "object") {
      const contentType = (content as { type?: string }).type;
      if (contentType) {
        summary.contentType = contentType;
      }
      const text = (content as { text?: string }).text;
      if (typeof text === "string") {
        summary.contentTextLength = text.length;
      }
    }
  }
  return summary;
}

async function handleModeUpdate(
  chatId: string,
  update: SessionUpdateWithLegacy,
  sessionRuntime: SessionRuntimePort,
  sessionRepo: SessionRepositoryPort
): Promise<boolean> {
  if (update.sessionUpdate !== "current_mode_update") {
    return false;
  }

  const session = sessionRuntime.get(chatId);
  if (session?.modes) {
    session.modes.currentModeId = update.currentModeId;
  }
  if (session?.userId) {
    await sessionRepo.updateMetadata(chatId, session.userId, {
      modeId: update.currentModeId,
    });
  }
  console.log(`[Server] Received mode update: ${update.currentModeId}`);
  sessionRuntime.broadcast(chatId, {
    type: "current_mode_update",
    modeId: update.currentModeId,
  });
  return true;
}

async function handleCommandsUpdate(
  chatId: string,
  update: SessionUpdateWithLegacy,
  sessionRuntime: SessionRuntimePort,
  sessionRepo: SessionRepositoryPort
): Promise<boolean> {
  if (update.sessionUpdate !== "available_commands_update") {
    return false;
  }

  const session = sessionRuntime.get(chatId);
  if (session) {
    session.commands = update.availableCommands;
  }
  if (session?.userId) {
    await sessionRepo.updateMetadata(chatId, session.userId, {
      commands: update.availableCommands,
    });
  }
  console.log("[Server] Received commands update", update.availableCommands);
  sessionRuntime.broadcast(chatId, {
    type: "available_commands_update",
    availableCommands: update.availableCommands,
  });
  return true;
}

/**
 * Creates a session update handler for processing updates from agent processes.
 */
export function createSessionUpdateHandler(
  sessionRuntime: SessionRuntimePort,
  sessionRepo: SessionRepositoryPort
) {
  return async function handleSessionUpdate(params: {
    chatId: string;
    buffer: SessionBufferingPort;
    isReplayingHistory: boolean;
    update: SessionUpdateWithLegacy;
  }) {
    const { chatId, buffer, isReplayingHistory, update } = params;

    trackReplayEvents(buffer, isReplayingHistory, update);

    const suppressReplay =
      isReplayingHistory &&
      Boolean(sessionRuntime.get(chatId)?.suppressReplayBroadcast);
    const summary = summarizeUpdate(update);
    logger.debug("ACP session update", {
      chatId,
      isReplayingHistory,
      suppressReplay,
      ...summary,
    });
    if (suppressReplay) {
      return;
    }

    maybeMarkStreaming(chatId, isReplayingHistory, update, sessionRuntime);

    await handleBufferedMessage(
      chatId,
      buffer,
      isReplayingHistory,
      update,
      sessionRepo,
      sessionRuntime,
      finalizeStreamingForCurrentAssistant
    );

    if (await handleModeUpdate(chatId, update, sessionRuntime, sessionRepo)) {
      return;
    }
    if (
      await handleCommandsUpdate(chatId, update, sessionRuntime, sessionRepo)
    ) {
      return;
    }
    if (
      await handlePlanUpdate({
        chatId,
        update,
        sessionRuntime,
        sessionRepo,
        finalizeStreamingForCurrentAssistant,
      })
    ) {
      return;
    }
    if (
      handleToolCallCreate({
        chatId,
        update,
        sessionRuntime,
        finalizeStreamingForCurrentAssistant,
      })
    ) {
      return;
    }
    if (handleToolCallUpdate({ chatId, update, sessionRuntime })) {
      return;
    }

    if (update.sessionUpdate !== "agent_message_chunk") {
      console.log(
        `[Server] Received session update: ${update.sessionUpdate}`,
        JSON.stringify(update, null, 2)
      );
    }
  };
}

function trackReplayEvents(
  buffer: SessionBufferingPort,
  isReplayingHistory: boolean,
  update: SessionUpdateWithLegacy
) {
  if (isReplayingHistory && isReplayChunk(update)) {
    buffer.replayEventCount += 1;
  }
}

function maybeMarkStreaming(
  chatId: string,
  isReplayingHistory: boolean,
  update: SessionUpdateWithLegacy,
  sessionRuntime: SessionRuntimePort
) {
  if (isReplayingHistory || !isStreamingUpdate(update)) {
    return;
  }
  const session = sessionRuntime.get(chatId);
  if (!session || session.chatStatus === "cancelling") {
    return;
  }
  updateChatStatus({
    chatId,
    session,
    broadcast: sessionRuntime.broadcast.bind(sessionRuntime),
    status: "streaming",
  });
}
