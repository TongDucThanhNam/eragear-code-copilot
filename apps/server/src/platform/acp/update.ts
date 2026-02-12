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
import { shouldEmitRuntimeLog } from "@/platform/logging/runtime-log-level";
import { createLogger } from "@/platform/logging/structured-logger";
import { updateChatStatus } from "@/shared/utils/chat-events.util";
import { finalizeStreamingParts } from "@/shared/utils/ui-message.util";
import { SessionBuffering as SessionBufferingImpl } from "./update-buffer";
import { handlePlanUpdate } from "./update-plan";
import { handleBufferedMessage, isStreamingUpdate } from "./update-stream";
import { handleToolCallCreate, handleToolCallUpdate } from "./update-tool";
import type { SessionUpdate, SessionUpdateContext } from "./update-types";
import { isReplayChunk } from "./update-types";

export const SessionBuffering = SessionBufferingImpl;

const logger = createLogger("Debug");

async function finalizeStreamingForCurrentAssistant(
  chatId: string,
  sessionRuntime: SessionRuntimePort
): Promise<void> {
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
  await sessionRuntime.broadcast(chatId, { type: "ui_message", message });
}

function summarizeUpdate(update: SessionUpdate) {
  switch (update.sessionUpdate) {
    case "user_message_chunk":
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      const content = update.content;
      if (content.type === "text") {
        return {
          sessionUpdate: update.sessionUpdate,
          hasMeta: Boolean(update._meta),
          contentType: content.type,
          contentTextLength: content.text.length,
        };
      }
      return {
        sessionUpdate: update.sessionUpdate,
        hasMeta: Boolean(update._meta),
        contentType: content.type,
      };
    }
    case "tool_call":
      return {
        sessionUpdate: update.sessionUpdate,
        toolCallId: update.toolCallId,
        toolKind: update.kind,
        toolStatus: update.status,
        hasMeta: Boolean(update._meta),
      };
    case "tool_call_update":
      return {
        sessionUpdate: update.sessionUpdate,
        toolCallId: update.toolCallId,
        toolStatus: update.status,
        hasMeta: Boolean(update._meta),
      };
    case "plan":
      return {
        sessionUpdate: update.sessionUpdate,
        planEntries: update.entries.length,
        hasMeta: Boolean(update._meta),
      };
    case "available_commands_update":
      return {
        sessionUpdate: update.sessionUpdate,
        availableCommandsCount: update.availableCommands.length,
        hasMeta: Boolean(update._meta),
      };
    case "current_mode_update":
      return {
        sessionUpdate: update.sessionUpdate,
        currentModeId: update.currentModeId,
        hasMeta: Boolean(update._meta),
      };
    case "config_option_update":
      return {
        sessionUpdate: update.sessionUpdate,
        configOptionsCount: update.configOptions.length,
        hasMeta: Boolean(update._meta),
      };
    case "session_info_update":
      return {
        sessionUpdate: update.sessionUpdate,
        hasMeta: Boolean(update._meta),
      };
    default:
      return {
        sessionUpdate: update.sessionUpdate,
        hasMeta: "_meta" in update ? Boolean(update._meta) : false,
      };
  }
}

async function handleModeUpdate(
  context: Pick<
    SessionUpdateContext,
    "chatId" | "update" | "sessionRuntime" | "sessionRepo"
  >
): Promise<boolean> {
  const { chatId, update, sessionRuntime, sessionRepo } = context;
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
  logger.debug("ACP current mode update", {
    chatId,
    modeId: update.currentModeId,
  });
  await sessionRuntime.broadcast(chatId, {
    type: "current_mode_update",
    modeId: update.currentModeId,
  });
  return true;
}

async function handleCommandsUpdate(
  context: Pick<
    SessionUpdateContext,
    "chatId" | "update" | "sessionRuntime" | "sessionRepo"
  >
): Promise<boolean> {
  const { chatId, update, sessionRuntime, sessionRepo } = context;
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
  logger.debug("ACP available commands update", {
    chatId,
    availableCommandsCount: update.availableCommands.length,
  });
  await sessionRuntime.broadcast(chatId, {
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
    update: SessionUpdate;
  }) {
    const { chatId, buffer, isReplayingHistory, update } = params;

    trackReplayEvents(buffer, isReplayingHistory, update);

    const suppressReplay =
      isReplayingHistory &&
      Boolean(sessionRuntime.get(chatId)?.suppressReplayBroadcast);
    const isDebugEnabled = shouldEmitRuntimeLog("debug");
    const summary = isDebugEnabled ? summarizeUpdate(update) : undefined;
    if (isDebugEnabled && summary) {
      logger.debug("ACP session update", {
        chatId,
        isReplayingHistory,
        suppressReplay,
        ...summary,
      });
    }
    if (suppressReplay) {
      return;
    }

    await sessionRuntime.runExclusive(chatId, async () => {
      await maybeMarkStreaming(
        chatId,
        isReplayingHistory,
        update,
        sessionRuntime
      );

      const context: SessionUpdateContext = {
        chatId,
        buffer,
        isReplayingHistory,
        update,
        sessionRuntime,
        sessionRepo,
        finalizeStreamingForCurrentAssistant,
      };

      await handleBufferedMessage(context);

      if (await handleModeUpdate(context)) {
        return;
      }
      if (await handleCommandsUpdate(context)) {
        return;
      }
      if (await handlePlanUpdate(context)) {
        return;
      }
      if (await handleToolCallCreate(context)) {
        return;
      }
      if (await handleToolCallUpdate(context)) {
        return;
      }

      if (isDebugEnabled && summary) {
        logger.debug("ACP session update ignored by pipeline", {
          chatId,
          ...summary,
        });
      }
    });
  };
}

function trackReplayEvents(
  buffer: SessionBufferingPort,
  isReplayingHistory: boolean,
  update: SessionUpdate
): void {
  if (isReplayingHistory && isReplayChunk(update)) {
    buffer.replayEventCount += 1;
  }
}

async function maybeMarkStreaming(
  chatId: string,
  isReplayingHistory: boolean,
  update: SessionUpdate,
  sessionRuntime: SessionRuntimePort
): Promise<void> {
  if (isReplayingHistory || !isStreamingUpdate(update)) {
    return;
  }
  const session = sessionRuntime.get(chatId);
  if (!session || session.chatStatus === "cancelling") {
    return;
  }
  await updateChatStatus({
    chatId,
    session,
    broadcast: sessionRuntime.broadcast.bind(sessionRuntime),
    status: "streaming",
  });
}
