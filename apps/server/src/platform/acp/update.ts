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
import { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import { shouldEmitRuntimeLog } from "@/platform/logging/runtime-log-level";
import { createLogger } from "@/platform/logging/structured-logger";
import {
  findSessionConfigOption,
  syncSessionSelectionFromConfigOptions,
  updateSessionConfigOptionCurrentValue,
} from "@/shared/utils/session-config-options.util";
import {
  appendReasoningBlock,
  finalizeStreamingParts,
  getOrCreateAssistantMessage,
} from "@/shared/utils/ui-message.util";
import { broadcastUiMessagePart } from "./ui-message-part";
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
  sessionRuntime: SessionRuntimePort,
  buffer: SessionBufferingPort,
  options?: { suppressBroadcast?: boolean }
): Promise<void> {
  const suppressBroadcast = options?.suppressBroadcast === true;
  const session = sessionRuntime.get(chatId);
  if (!session) {
    return;
  }

  const targetMessageId =
    session.uiState.currentAssistantId ?? buffer.getMessageId();
  if (!targetMessageId) {
    return;
  }

  let message = session.uiState.messages.get(targetMessageId);
  if (!message) {
    message = getOrCreateAssistantMessage(session.uiState, targetMessageId);
  }

  let nextMessage = message;

  // Flush any pending reasoning blocks → broadcast each as a complete part
  const pendingReasoning = buffer.consumePendingReasoning();
  if (pendingReasoning?.blocks.length) {
    // Log aggregated reasoning part completion
    logger.info("ACP reasoning part complete", {
      chatId,
      totalChunks: pendingReasoning.chunkCount,
      totalChars: pendingReasoning.text.length,
      durationMs: pendingReasoning.durationMs,
    });

    const previousPartsLength = nextMessage.parts.length;
    let updatedMessage = nextMessage;
    for (const block of pendingReasoning.blocks) {
      updatedMessage = appendReasoningBlock(updatedMessage, block, "done");
    }
    if (updatedMessage !== nextMessage) {
      const nextPartIndex = updatedMessage.parts.length - 1;
      const isNew = updatedMessage.parts.length > previousPartsLength;
      session.uiState.messages.set(updatedMessage.id, updatedMessage);
      nextMessage = updatedMessage;
      if (!suppressBroadcast && nextPartIndex >= 0) {
        await broadcastUiMessagePart({
          chatId,
          sessionRuntime,
          message: updatedMessage,
          partIndex: nextPartIndex,
          isNew,
        });
      }
    }
  }

  // Finalize any remaining streaming text/reasoning parts → state: "done"
  const hasStreaming = nextMessage.parts.some(
    (part) =>
      (part.type === "text" || part.type === "reasoning") &&
      part.state === "streaming"
  );
  if (!hasStreaming) {
    return;
  }
  const finalizedMessage = finalizeStreamingParts(nextMessage);
  if (finalizedMessage !== nextMessage) {
    session.uiState.messages.set(finalizedMessage.id, finalizedMessage);
  }
  if (suppressBroadcast) {
    return;
  }

  // Broadcast only the parts that actually changed (streaming → done)
  for (let index = 0; index < finalizedMessage.parts.length; index += 1) {
    const previousPart = nextMessage.parts[index];
    const finalizedPart = finalizedMessage.parts[index];
    if (!(previousPart && finalizedPart) || previousPart === finalizedPart) {
      continue;
    }
    await broadcastUiMessagePart({
      chatId,
      sessionRuntime,
      message: finalizedMessage,
      partIndex: index,
      isNew: false,
    });
  }
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
    | "chatId"
    | "update"
    | "sessionRuntime"
    | "sessionRepo"
    | "suppressReplayBroadcast"
  >
): Promise<boolean> {
  const {
    chatId,
    update,
    sessionRuntime,
    sessionRepo,
    suppressReplayBroadcast,
  } = context;
  if (update.sessionUpdate !== "current_mode_update") {
    return false;
  }

  const session = sessionRuntime.get(chatId);
  if (session) {
    if (session.modes) {
      session.modes.currentModeId = update.currentModeId;
    } else {
      session.modes = {
        currentModeId: update.currentModeId,
        availableModes: [],
      };
    }
    updateSessionConfigOptionCurrentValue({
      configOptions: session.configOptions,
      target: "mode",
      value: update.currentModeId,
    });
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
  if (!suppressReplayBroadcast) {
    await sessionRuntime.broadcast(chatId, {
      type: "current_mode_update",
      modeId: update.currentModeId,
    });
  }
  return true;
}

async function handleCommandsUpdate(
  context: Pick<
    SessionUpdateContext,
    | "chatId"
    | "update"
    | "sessionRuntime"
    | "sessionRepo"
    | "suppressReplayBroadcast"
  >
): Promise<boolean> {
  const {
    chatId,
    update,
    sessionRuntime,
    sessionRepo,
    suppressReplayBroadcast,
  } = context;
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
  if (!suppressReplayBroadcast) {
    await sessionRuntime.broadcast(chatId, {
      type: "available_commands_update",
      availableCommands: update.availableCommands,
    });
  }
  return true;
}

async function handleConfigOptionsUpdate(
  context: Pick<
    SessionUpdateContext,
    | "chatId"
    | "update"
    | "sessionRuntime"
    | "sessionRepo"
    | "suppressReplayBroadcast"
  >
): Promise<boolean> {
  const {
    chatId,
    update,
    sessionRuntime,
    sessionRepo,
    suppressReplayBroadcast,
  } = context;
  if (update.sessionUpdate !== "config_option_update") {
    return false;
  }

  const session = sessionRuntime.get(chatId);
  if (!session) {
    return true;
  }

  const configOptions = update.configOptions.map((option) => ({
    ...option,
  }));
  session.configOptions = configOptions;

  const modeOption = findSessionConfigOption(configOptions, "mode");
  const modelOption = findSessionConfigOption(configOptions, "model");
  const selection = syncSessionSelectionFromConfigOptions(session);

  if (session.userId) {
    const metadataUpdates: {
      modeId?: string;
      modelId?: string;
    } = {};
    if (modeOption && selection.modeId) {
      metadataUpdates.modeId = selection.modeId;
    }
    if (modelOption && selection.modelId) {
      metadataUpdates.modelId = selection.modelId;
    }
    if (metadataUpdates.modeId || metadataUpdates.modelId) {
      await sessionRepo.updateMetadata(chatId, session.userId, metadataUpdates);
    }
  }

  logger.debug("ACP config options update", {
    chatId,
    configOptionsCount: configOptions.length,
    hasModeOption: Boolean(modeOption),
    hasModelOption: Boolean(modelOption),
  });

  if (!suppressReplayBroadcast) {
    await sessionRuntime.broadcast(chatId, {
      type: "config_options_update",
      configOptions,
    });
    if (modeOption && selection.modeChanged && selection.modeId) {
      await sessionRuntime.broadcast(chatId, {
        type: "current_mode_update",
        modeId: selection.modeId,
      });
    }
    if (modelOption && selection.modelChanged && selection.modelId) {
      await sessionRuntime.broadcast(chatId, {
        type: "current_model_update",
        modelId: selection.modelId,
      });
    }
  }

  return true;
}

async function handleSessionInfoUpdate(
  context: Pick<
    SessionUpdateContext,
    "chatId" | "update" | "sessionRuntime" | "suppressReplayBroadcast"
  >
): Promise<boolean> {
  const { chatId, update, sessionRuntime, suppressReplayBroadcast } = context;
  if (update.sessionUpdate !== "session_info_update") {
    return false;
  }

  const session = sessionRuntime.get(chatId);
  if (!session) {
    return true;
  }

  const hasTitle = Object.hasOwn(update, "title");
  const hasUpdatedAt = Object.hasOwn(update, "updatedAt");
  if (!(hasTitle || hasUpdatedAt)) {
    return true;
  }

  const sessionInfo = {
    ...(session.sessionInfo ?? {}),
    ...(hasTitle ? { title: update.title ?? null } : {}),
    ...(hasUpdatedAt ? { updatedAt: update.updatedAt ?? null } : {}),
  };
  session.sessionInfo = sessionInfo;

  logger.debug("ACP session info update", {
    chatId,
    hasTitle,
    hasUpdatedAt,
  });

  if (!suppressReplayBroadcast) {
    await sessionRuntime.broadcast(chatId, {
      type: "session_info_update",
      sessionInfo,
    });
  }

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
    if (suppressReplay && isDebugEnabled && summary) {
      logger.debug("ACP replay update broadcast suppressed", {
        chatId,
        replayEventCount: buffer.replayEventCount,
        ...summary,
      });
    }

    await sessionRuntime.runExclusive(chatId, async () => {
      await maybeMarkStreaming(
        chatId,
        isReplayingHistory,
        update,
        sessionRuntime
      );

      const activeSession = sessionRuntime.get(chatId);
      if (activeSession && update.sessionUpdate !== "user_message_chunk") {
        // Keep user chunk aggregation bounded to one contiguous user stream.
        activeSession.uiState.currentUserId = undefined;
      }

      const context: SessionUpdateContext = {
        chatId,
        buffer,
        isReplayingHistory,
        suppressReplayBroadcast: suppressReplay,
        update,
        sessionRuntime,
        sessionRepo,
        finalizeStreamingForCurrentAssistant,
      };

      const handledByChunkPipeline = await handleBufferedMessage(context);

      if (await handleModeUpdate(context)) {
        return;
      }
      if (await handleCommandsUpdate(context)) {
        return;
      }
      if (await handleConfigOptionsUpdate(context)) {
        return;
      }
      if (await handleSessionInfoUpdate(context)) {
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

      if (summary && !handledByChunkPipeline) {
        const ignoredContext = {
          chatId,
          ...summary,
        };
        if (shouldWarnUnhandledChunkUpdate(update)) {
          logger.warn("ACP chunk update ignored by pipeline", ignoredContext);
        } else if (isDebugEnabled) {
          logger.debug("ACP session update ignored by pipeline", ignoredContext);
        }
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
  if (!session) {
    return;
  }
  const runtime = new SessionRuntimeEntity(session);
  if (!runtime.shouldStreamFromActivity()) {
    if (shouldEmitRuntimeLog("debug")) {
      logger.debug("Skip streaming status update without active turn", {
        chatId,
        sessionUpdate: update.sessionUpdate,
        chatStatus: session.chatStatus,
      });
    }
    return;
  }
  await runtime.markStreamingFromActivity({
    chatId,
    broadcast: sessionRuntime.broadcast.bind(sessionRuntime),
  });
}

function shouldWarnUnhandledChunkUpdate(update: SessionUpdate): boolean {
  const kind =
    typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";
  if (!kind.toLowerCase().includes("chunk")) {
    return false;
  }
  return (
    kind !== "user_message_chunk" &&
    kind !== "agent_message_chunk" &&
    kind !== "agent_thought_chunk"
  );
}
