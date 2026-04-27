/**
 * ACP Session Update Handler
 *
 * Orchestrates session updates from agent processes while delegating
 * streaming, plan, and tool-call logic to focused handlers.
 *
 * @module infra/acp/update
 */

import { DEFAULT_MAX_VISIBLE_MODEL_COUNT } from "@/config/constants";
import { ENV } from "@/config/environment";
import type {
  SessionBufferingPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import { shouldEmitRuntimeLog } from "@/platform/logging/runtime-log-level";
import { createLogger } from "@/platform/logging/structured-logger";
import type { ChatSession } from "@/shared/types/session.types";
import {
  diagnosticsLog,
  isDiagnosticsEnabled,
} from "@/shared/utils/diagnostics.util";
import {
  capModelList,
  findSessionConfigOption,
  syncSessionSelectionFromConfigOptions,
  updateSessionConfigOptionCurrentValue,
} from "@/shared/utils/session-config-options.util";
import {
  appendReasoningBlock,
  finalizeStreamingParts,
  getOrCreateAssistantMessage,
} from "@/shared/utils/ui-message.util";
import {
  disposeThrottledBroadcasts,
  flushThrottledBroadcasts,
} from "./broadcast-throttle";
import {
  recordTurnIdDrop,
  recordTurnIdResolution,
} from "./turn-id-observability";
import { broadcastUiMessagePart } from "./ui-message-part";
import { SessionBuffering as SessionBufferingImpl } from "./update-buffer";
import { handlePlanUpdate } from "./update-plan";
import { handleBufferedMessage, isStreamingUpdate } from "./update-stream";
import { handleToolCallCreate, handleToolCallUpdate } from "./update-tool";
import { resolveSessionUpdateTurnId } from "./update-turn-id";
import type { SessionUpdate, SessionUpdateContext } from "./update-types";
import { isReplayChunk } from "./update-types";

export const SessionBuffering = SessionBufferingImpl;

const logger = createLogger("Debug");
const COMPLETED_TURN_LATE_CHUNK_GRACE_MS = 2500;

/** [DIAG] Log original vs capped model/config option counts around capModelList. */
function diagnosticsLogConfigOptionsCap(
  chatId: string,
  configOptions: NonNullable<ChatSession["configOptions"]>
): void {
  if (!isDiagnosticsEnabled()) {
    return;
  }
  const modelOption = findSessionConfigOption(configOptions, "model");
  if (!modelOption) {
    return;
  }
  const originalCount = Array.isArray(modelOption.options)
    ? modelOption.options.length
    : 0;
  diagnosticsLog("config-options-cap", {
    chatId,
    configOptionsCount: configOptions.length,
    modelOptionOriginalCount: originalCount,
  });
}

async function finalizeStreamingForCurrentAssistant(
  chatId: string,
  sessionRuntime: SessionRuntimePort,
  buffer: SessionBufferingPort,
  options?: { suppressBroadcast?: boolean }
): Promise<void> {
  const suppressBroadcast = options?.suppressBroadcast === true;

  // Flush any throttled streaming broadcasts so the client receives the
  // last accumulated snapshot *before* any finalize/done events.
  if (suppressBroadcast) {
    // When broadcasts are suppressed (replay), discard pending throttled
    // events to avoid leaking stale snapshots after the replay completes.
    disposeThrottledBroadcasts(chatId);
  } else {
    await flushThrottledBroadcasts(chatId);
  }

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
          turnId: session.activeTurnId,
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
  const changedPartIndexes: number[] = [];
  for (let index = 0; index < finalizedMessage.parts.length; index += 1) {
    const previousPart = nextMessage.parts[index];
    const finalizedPart = finalizedMessage.parts[index];
    if (!(previousPart && finalizedPart) || previousPart === finalizedPart) {
      continue;
    }
    changedPartIndexes.push(index);
  }
  await Promise.all(
    changedPartIndexes.map((partIndex) =>
      broadcastUiMessagePart({
        chatId,
        sessionRuntime,
        message: finalizedMessage,
        partIndex,
        isNew: false,
        turnId: session.activeTurnId,
      })
    )
  );
}

function isTurnScopedSessionUpdate(update: SessionUpdate): boolean {
  return (
    update.sessionUpdate === "user_message_chunk" ||
    update.sessionUpdate === "agent_message_chunk" ||
    update.sessionUpdate === "agent_thought_chunk" ||
    update.sessionUpdate === "tool_call" ||
    update.sessionUpdate === "tool_call_update" ||
    update.sessionUpdate === "plan"
  );
}

function shouldIgnoreStaleTurnScopedUpdate(params: {
  chatId: string;
  isReplayingHistory: boolean;
  sessionRuntime: SessionRuntimePort;
  update: SessionUpdate;
  turnIdResolution: ReturnType<typeof resolveSessionUpdateTurnId>;
}): boolean {
  const {
    chatId,
    isReplayingHistory,
    sessionRuntime,
    update,
    turnIdResolution,
  } = params;
  if (isReplayingHistory || !isTurnScopedSessionUpdate(update)) {
    return false;
  }

  recordTurnIdResolution("sessionUpdate", turnIdResolution.source);

  if (
    ENV.acpTurnIdPolicy === "require-native" &&
    turnIdResolution.source !== "native"
  ) {
    logger.warn(
      "Ignoring ACP update without native turnId under strict policy",
      {
        chatId,
        sessionUpdate: update.sessionUpdate,
        turnIdSource: turnIdResolution.source,
      }
    );
    recordTurnIdDrop("requireNativePolicy");
    return true;
  }

  const session = sessionRuntime.get(chatId);
  if (!session) {
    return false;
  }

  const updateTurnId = turnIdResolution.turnId;
  if (!updateTurnId) {
    return false;
  }

  if (!session.activeTurnId) {
    const recentlyCompletedTurnId = session.lastCompletedTurnId;
    const recentlyCompletedTurnAtMs = session.lastCompletedTurnAtMs;
    const completedTurnAgeMs =
      typeof recentlyCompletedTurnAtMs === "number"
        ? Date.now() - recentlyCompletedTurnAtMs
        : null;
    const isWithinRecentCompletedWindow =
      typeof completedTurnAgeMs === "number" &&
      completedTurnAgeMs <= COMPLETED_TURN_LATE_CHUNK_GRACE_MS;
    const isRecentLateChunk =
      recentlyCompletedTurnId === updateTurnId && isWithinRecentCompletedWindow;
    if (isRecentLateChunk) {
      if (isDebugEnabled()) {
        logger.debug("Accepting late ACP update for recently completed turn", {
          chatId,
          sessionUpdate: update.sessionUpdate,
          updateTurnId,
          completedTurnId: recentlyCompletedTurnId,
          ageMs: completedTurnAgeMs,
          graceMs: COMPLETED_TURN_LATE_CHUNK_GRACE_MS,
        });
      }
      return false;
    }
    logger.warn("Ignoring late ACP update after active turn cleared", {
      chatId,
      sessionUpdate: update.sessionUpdate,
      updateTurnId,
      completedTurnId: recentlyCompletedTurnId ?? null,
      completedTurnAgeMs,
    });
    recordTurnIdDrop("lateAfterTurnCleared");
    return true;
  }

  if (session.activeTurnId !== updateTurnId) {
    logger.warn("Ignoring stale ACP update with mismatched turnId", {
      chatId,
      sessionUpdate: update.sessionUpdate,
      updateTurnId,
      activeTurnId: session.activeTurnId,
    });
    recordTurnIdDrop("staleTurnMismatch");
    return true;
  }

  return false;
}

function isDebugEnabled(): boolean {
  return shouldEmitRuntimeLog("debug");
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
        reason: readModeUpdateReason(update),
        metadata: readModeUpdateMetadata(update),
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

function shouldLogSessionUpdateSummary(update: SessionUpdate): boolean {
  switch (update.sessionUpdate) {
    case "current_mode_update":
    case "available_commands_update":
    case "config_option_update":
    case "session_info_update":
    case "tool_call":
    case "plan":
      return true;
    case "tool_call_update":
      return update.status === "completed" || update.status === "failed";
    default:
      return false;
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
  if (!canApplyModeUpdate(session, update.currentModeId)) {
    logger.warn("Rejected ACP current mode update outside advertised modes", {
      chatId,
      requestedModeId: update.currentModeId,
      availableModeIds:
        session?.modes?.availableModes.map((mode) => mode.id) ?? [],
    });
    return true;
  }

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
    reason: readModeUpdateReason(update),
    metadata: readModeUpdateMetadata(update),
  });
  if (!suppressReplayBroadcast) {
    await sessionRuntime.broadcast(chatId, {
      type: "current_mode_update",
      modeId: update.currentModeId,
      ...(readModeUpdateReason(update)
        ? { reason: readModeUpdateReason(update) }
        : {}),
      ...(readModeUpdateMetadata(update) !== undefined
        ? { metadata: readModeUpdateMetadata(update) }
        : // biome-ignore lint/style/noNestedTernary: Intentional fallback chain for metadata
          update._meta
          ? { metadata: update._meta }
          : {}),
    });
  }
  return true;
}

function canApplyModeUpdate(
  session: ChatSession | undefined,
  requestedModeId: string
): boolean {
  if (!session?.modes) {
    return false;
  }
  if (session.modes.availableModes.length === 0) {
    return false;
  }
  return session.modes.availableModes.some(
    (mode) => mode.id === requestedModeId
  );
}

function readModeUpdateReason(
  update: Extract<SessionUpdate, { sessionUpdate: "current_mode_update" }>
): string | undefined {
  const value = (update as Record<string, unknown>).reason;
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function readModeUpdateMetadata(
  update: Extract<SessionUpdate, { sessionUpdate: "current_mode_update" }>
): unknown {
  return (update as Record<string, unknown>).metadata;
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
    // Cap model/config-option lists before broadcasting to clients.
    // Internal session state (session.configOptions, session.models)
    // remains uncapped so validation (set-model, set-config-option)
    // continues to work against the full list.

    // [DIAG] Log original vs capped model option counts
    diagnosticsLogConfigOptionsCap(chatId, configOptions);

    const capped = capModelList({
      models: session.models?.availableModels,
      configOptions,
      currentModelId: session.models?.currentModelId,
      maxVisible: DEFAULT_MAX_VISIBLE_MODEL_COUNT,
    });

    await sessionRuntime.broadcast(chatId, {
      type: "config_options_update",
      configOptions: capped.configOptions,
    });
    if (modeOption && selection.modeChanged && selection.modeId) {
      await sessionRuntime.broadcast(chatId, {
        type: "current_mode_update",
        modeId: selection.modeId,
        reason: "config_option_update",
        metadata: {
          source: "config_option_update",
          configId: modeOption.id,
        },
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
  let updateTail: Promise<void> = Promise.resolve();

  return async function handleSessionUpdate(params: {
    chatId: string;
    buffer: SessionBufferingPort;
    isReplayingHistory: boolean;
    update: SessionUpdate;
  }) {
    const runUpdate = updateTail.then(async () => {
      const { chatId, buffer, isReplayingHistory, update } = params;
      const turnIdResolution = resolveSessionUpdateTurnId(update);

      trackReplayEvents(buffer, isReplayingHistory, update);

      const suppressReplay =
        isReplayingHistory &&
        Boolean(sessionRuntime.get(chatId)?.suppressReplayBroadcast);
      const isDebugEnabled = shouldEmitRuntimeLog("debug");
      const summary = isDebugEnabled ? summarizeUpdate(update) : undefined;
      if (isDebugEnabled && summary && shouldLogSessionUpdateSummary(update)) {
        logger.debug("ACP session update", {
          chatId,
          isReplayingHistory,
          suppressReplay,
          ...summary,
        });
      }

      await sessionRuntime.runExclusive(chatId, async () => {
        // [DIAG] Measure processSessionUpdateUnderLock duration
        let diagLockStart = 0;
        if (isDiagnosticsEnabled()) {
          diagLockStart = performance.now();
        }
        await processSessionUpdateUnderLock({
          chatId,
          buffer,
          isReplayingHistory,
          suppressReplay,
          update,
          turnIdResolution,
          sessionRuntime,
          sessionRepo,
          summary,
          isDebugEnabled,
        });
        // [DIAG] Log processSessionUpdateUnderLock duration
        if (isDiagnosticsEnabled()) {
          const diagDuration = performance.now() - diagLockStart;
          diagnosticsLog("update-under-lock", {
            chatId,
            updateType: update.sessionUpdate,
            isReplayingHistory,
            durationMs: diagDuration.toFixed(2),
          });
        }
      });
    });

    updateTail = runUpdate.then(
      () => undefined,
      () => undefined
    );

    await runUpdate;
  };
}

async function processSessionUpdateUnderLock(params: {
  chatId: string;
  buffer: SessionBufferingPort;
  isReplayingHistory: boolean;
  suppressReplay: boolean;
  update: SessionUpdate;
  turnIdResolution: ReturnType<typeof resolveSessionUpdateTurnId>;
  sessionRuntime: SessionRuntimePort;
  sessionRepo: SessionRepositoryPort;
  summary: ReturnType<typeof summarizeUpdate> | undefined;
  isDebugEnabled: boolean;
}): Promise<void> {
  const {
    chatId,
    buffer,
    isReplayingHistory,
    suppressReplay,
    update,
    turnIdResolution,
    sessionRuntime,
    sessionRepo,
    summary,
    isDebugEnabled,
  } = params;
  if (
    shouldIgnoreStaleTurnScopedUpdate({
      chatId,
      isReplayingHistory,
      sessionRuntime,
      update,
      turnIdResolution,
    })
  ) {
    return;
  }

  await maybeMarkStreaming(chatId, isReplayingHistory, update, sessionRuntime);
  clearCurrentUserStreamPointer(chatId, update, sessionRuntime);

  const context: SessionUpdateContext = {
    chatId,
    buffer,
    isReplayingHistory,
    suppressReplayBroadcast: suppressReplay,
    update,
    turnIdResolution,
    sessionRuntime,
    sessionRepo,
    finalizeStreamingForCurrentAssistant,
  };

  const handledByChunkPipeline = await handleBufferedMessage(context);
  const handled = await dispatchSessionUpdate(context);
  if (!summary || handledByChunkPipeline || handled) {
    return;
  }
  logIgnoredSessionUpdate({
    chatId,
    update,
    summary,
    isDebugEnabled,
  });
}

function clearCurrentUserStreamPointer(
  chatId: string,
  update: SessionUpdate,
  sessionRuntime: SessionRuntimePort
): void {
  const activeSession = sessionRuntime.get(chatId);
  if (!activeSession || update.sessionUpdate === "user_message_chunk") {
    return;
  }
  // Keep user chunk aggregation bounded to one contiguous user stream.
  activeSession.uiState.currentUserId = undefined;
  activeSession.uiState.currentUserSource = undefined;
}

async function dispatchSessionUpdate(
  context: SessionUpdateContext
): Promise<boolean> {
  if (await handleModeUpdate(context)) {
    return true;
  }
  if (await handleCommandsUpdate(context)) {
    return true;
  }
  if (await handleConfigOptionsUpdate(context)) {
    return true;
  }
  if (await handleSessionInfoUpdate(context)) {
    return true;
  }
  if (await handlePlanUpdate(context)) {
    return true;
  }
  if (await handleToolCallCreate(context)) {
    return true;
  }
  if (await handleToolCallUpdate(context)) {
    return true;
  }
  return false;
}

function logIgnoredSessionUpdate(params: {
  chatId: string;
  update: SessionUpdate;
  summary: ReturnType<typeof summarizeUpdate>;
  isDebugEnabled: boolean;
}): void {
  const { chatId, update, summary, isDebugEnabled } = params;
  const ignoredContext = {
    chatId,
    ...summary,
  };
  if (shouldWarnUnhandledChunkUpdate(update)) {
    logger.warn("ACP chunk update ignored by pipeline", ignoredContext);
    return;
  }
  if (isDebugEnabled) {
    logger.debug("ACP session update ignored by pipeline", ignoredContext);
  }
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
