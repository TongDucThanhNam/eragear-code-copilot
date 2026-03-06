import type * as acp from "@agentclientprotocol/sdk";
import type { UIMessage } from "@repo/shared";
import { createLogger } from "@/platform/logging/structured-logger";
import {
  type StoredContentContext,
  toStoredToolCallContent,
} from "@/shared/utils/content-block.util";
import {
  buildToolPartForUpdate,
  buildToolPartFromCall,
  upsertToolLocationsPart,
  upsertToolPart,
} from "@/shared/utils/ui-message.util";
import { broadcastUiMessagePart } from "./ui-message-part";
import type { SessionUpdate, SessionUpdateContext } from "./update-types";
import { isToolCallCreate, isToolCallUpdate } from "./update-types";

const TOOL_CALL_FALLBACK_KIND = "other";
const TOOL_CALL_ID_MAX_LENGTH = 256;
const WHITESPACE_PATTERN = /\s/u;
const logger = createLogger("Debug");

interface ToolPartIndex {
  messageId: string;
  partIndex: number;
}

function hasSafeToolCallIdCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || WHITESPACE_PATTERN.test(character)) {
      return false;
    }
  }
  return true;
}

function isValidToolCallId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= TOOL_CALL_ID_MAX_LENGTH &&
    hasSafeToolCallIdCharacters(value)
  );
}

export async function handleToolCallCreate(
  context: SessionUpdateContext
): Promise<boolean> {
  const {
    chatId,
    buffer,
    update,
    sessionRuntime,
    suppressReplayBroadcast,
    finalizeStreamingForCurrentAssistant,
  } = context;
  if (!isToolCallCreate(update)) {
    return false;
  }
  if (!isValidToolCallId(update.toolCallId)) {
    logger.warn("Dropped tool_call with invalid toolCallId", {
      chatId,
      toolCallIdLength: update.toolCallId.length,
    });
    return false;
  }

  await finalizeStreamingForCurrentAssistant(chatId, sessionRuntime, buffer, {
    suppressBroadcast: suppressReplayBroadcast,
  });
  const session = sessionRuntime.get(chatId);
  const storedContentContext: StoredContentContext | undefined = session
    ? { userId: session.userId, chatId }
    : undefined;

  const { sessionUpdate: _sessionUpdate, ...toolCall } = update;
  const sanitizedToolCall: acp.ToolCall = {
    ...toolCall,
    kind: toolCall.kind ?? TOOL_CALL_FALLBACK_KIND,
    content: toStoredToolCallContent(toolCall.content, storedContentContext),
  };
  if (session) {
    session.toolCalls.set(update.toolCallId, sanitizedToolCall);
  }
  if (session) {
    const eventTurnId = context.turnIdResolution.turnId ?? session.activeTurnId;
    const previousToolIndex = session.uiState.toolPartIndex.get(
      update.toolCallId
    );
    const previousLocationPartIndex = findToolLocationsPartIndex(
      session.uiState.messages.get(session.uiState.currentAssistantId ?? "") ??
        null,
      update.toolCallId
    );
    const toolPart = buildToolPartFromCall(sanitizedToolCall);
    const { message } = upsertToolPart({
      state: session.uiState,
      messageId: session.uiState.currentAssistantId,
      part: toolPart,
      turnId: eventTurnId,
    });
    const messageWithLocations = sanitizedToolCall.locations?.length
      ? upsertToolLocationsPart({
          state: session.uiState,
          toolCallId: sanitizedToolCall.toolCallId,
          locations: sanitizedToolCall.locations,
          messageId: message.id,
        })
      : message;
    await broadcastToolCallParts({
      chatId,
      sessionRuntime,
      toolCallId: update.toolCallId,
      message,
      messageWithLocations,
      previousToolIndex,
      previousLocationPartIndex,
      suppressReplayBroadcast,
      turnId: eventTurnId,
    });
  }
  return true;
}

export async function handleToolCallUpdate(
  context: Pick<
    SessionUpdateContext,
    | "chatId"
    | "update"
    | "turnIdResolution"
    | "sessionRuntime"
    | "suppressReplayBroadcast"
    | "buffer"
    | "finalizeStreamingForCurrentAssistant"
  >
): Promise<boolean> {
  const {
    chatId,
    update,
    sessionRuntime,
    suppressReplayBroadcast,
    buffer,
    finalizeStreamingForCurrentAssistant,
  } = context;
  if (!isToolCallUpdate(update)) {
    return false;
  }
  if (!isValidToolCallId(update.toolCallId)) {
    logger.warn("Dropped tool_call_update with invalid toolCallId", {
      chatId,
      toolCallIdLength: update.toolCallId.length,
    });
    return false;
  }

  await finalizeStreamingForCurrentAssistant(chatId, sessionRuntime, buffer, {
    suppressBroadcast: suppressReplayBroadcast,
  });

  const session = sessionRuntime.get(chatId);
  const storedContentContext: StoredContentContext | undefined = session
    ? { userId: session.userId, chatId }
    : undefined;
  if (session) {
    const existing = session.toolCalls.get(update.toolCallId);
    const mergedToolCall = existing
      ? mergeToolCallUpdate(existing, update, storedContentContext)
      : createToolCallFromUpdate(update, storedContentContext);
    session.toolCalls.set(update.toolCallId, mergedToolCall);
  }

  if (session) {
    const eventTurnId = context.turnIdResolution.turnId ?? session.activeTurnId;
    const previousToolIndex = session.uiState.toolPartIndex.get(
      update.toolCallId
    );
    const previousLocationPartIndex = findToolLocationsPartIndex(
      session.uiState.messages.get(session.uiState.currentAssistantId ?? "") ??
        null,
      update.toolCallId
    );
    const mergedToolCall = session.toolCalls.get(update.toolCallId);
    if (!mergedToolCall) {
      return true;
    }
    const toolPart = buildToolPartForUpdate({
      toolCallId: mergedToolCall.toolCallId,
      toolName: mergedToolCall.kind,
      title: mergedToolCall.title,
      status: mergedToolCall.status,
      content: mergedToolCall.content,
      rawOutput: mergedToolCall.rawOutput,
      rawInput: mergedToolCall.rawInput,
      meta: mergedToolCall._meta,
    });
    const { message } = upsertToolPart({
      state: session.uiState,
      messageId: session.uiState.currentAssistantId,
      part: toolPart,
      turnId: eventTurnId,
    });
    const nextLocations =
      update.locations === undefined
        ? mergedToolCall.locations
        : (update.locations ?? undefined);
    const messageWithLocations = upsertToolLocationsPart({
      state: session.uiState,
      toolCallId: update.toolCallId,
      locations: nextLocations,
      messageId: message.id,
    });
    await broadcastToolCallParts({
      chatId,
      sessionRuntime,
      toolCallId: update.toolCallId,
      message,
      messageWithLocations,
      previousToolIndex,
      previousLocationPartIndex,
      suppressReplayBroadcast,
      turnId: eventTurnId,
    });
  }
  return true;
}

async function broadcastToolCallParts(params: {
  chatId: string;
  sessionRuntime: SessionUpdateContext["sessionRuntime"];
  toolCallId: string;
  message: UIMessage;
  messageWithLocations: UIMessage | null | undefined;
  previousToolIndex?: ToolPartIndex;
  previousLocationPartIndex: number;
  suppressReplayBroadcast: boolean;
  turnId?: string;
}): Promise<void> {
  const {
    chatId,
    sessionRuntime,
    toolCallId,
    message,
    messageWithLocations,
    previousToolIndex,
    previousLocationPartIndex,
    suppressReplayBroadcast,
    turnId,
  } = params;
  if (suppressReplayBroadcast) {
    return;
  }
  const resolvedToolIndex =
    sessionRuntime.get(chatId)?.uiState.toolPartIndex.get(toolCallId) ??
    undefined;
  if (resolvedToolIndex && resolvedToolIndex.messageId === message.id) {
    await broadcastUiMessagePart({
      chatId,
      sessionRuntime,
      message,
      partIndex: resolvedToolIndex.partIndex,
      isNew:
        !previousToolIndex ||
        previousToolIndex.messageId !== resolvedToolIndex.messageId ||
        previousToolIndex.partIndex !== resolvedToolIndex.partIndex,
      turnId,
    });
  }
  const locationPartIndex = findToolLocationsPartIndex(
    messageWithLocations ?? message,
    toolCallId
  );
  if (locationPartIndex < 0) {
    return;
  }
  await broadcastUiMessagePart({
    chatId,
    sessionRuntime,
    message: messageWithLocations ?? message,
    partIndex: locationPartIndex,
    isNew: previousLocationPartIndex < 0,
    turnId,
  });
}

function mergeToolCallUpdate(
  existing: acp.ToolCall,
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
  storedContentContext?: StoredContentContext
): acp.ToolCall {
  const mergedContent = resolveToolCallUpdateContent(
    existing.content,
    update.content,
    storedContentContext
  );
  const mergedMeta = update._meta ?? existing._meta;
  const mergedLocations =
    update.locations === undefined
      ? existing.locations
      : (update.locations ?? undefined);
  return {
    ...existing,
    status: update.status ?? existing.status,
    title: update.title ?? existing.title,
    kind: update.kind ?? existing.kind,
    rawInput:
      update.rawInput === undefined ? existing.rawInput : update.rawInput,
    rawOutput:
      update.rawOutput === undefined ? existing.rawOutput : update.rawOutput,
    content: mergedContent,
    locations: mergedLocations,
    _meta: mergedMeta,
  };
}

function createToolCallFromUpdate(
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
  storedContentContext?: StoredContentContext
): acp.ToolCall {
  const resolvedKind =
    typeof update.kind === "string" && update.kind.trim().length > 0
      ? update.kind
      : TOOL_CALL_FALLBACK_KIND;
  const resolvedTitle = update.title ?? resolvedKind;
  const resolvedLocations =
    update.locations === undefined
      ? undefined
      : (update.locations ?? undefined);

  return {
    toolCallId: update.toolCallId,
    title: resolvedTitle,
    kind: resolvedKind,
    status: update.status ?? undefined,
    rawInput: update.rawInput,
    rawOutput: update.rawOutput,
    content: resolveToolCallUpdateContent(
      undefined,
      update.content,
      storedContentContext
    ),
    locations: resolvedLocations,
    _meta: update._meta ?? undefined,
  };
}

function resolveToolCallUpdateContent(
  existing: acp.ToolCall["content"],
  incoming: acp.ToolCallUpdate["content"],
  storedContentContext?: StoredContentContext
): acp.ToolCall["content"] {
  if (incoming === undefined) {
    return existing;
  }
  if (incoming === null) {
    return undefined;
  }
  return toStoredToolCallContent(incoming, storedContentContext);
}

function findToolLocationsPartIndex(
  message: UIMessage | null,
  toolCallId: string
): number {
  if (!message) {
    return -1;
  }
  return message.parts.findIndex(
    (part) =>
      part.type === "data-tool-locations" &&
      typeof part.data === "object" &&
      part.data !== null &&
      (part.data as { toolCallId?: string }).toolCallId === toolCallId
  );
}
