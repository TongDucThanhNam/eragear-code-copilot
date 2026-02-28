import type * as acp from "@agentclientprotocol/sdk";
import type { UIMessage } from "@repo/shared";
import { toStoredToolCallContent } from "@/shared/utils/content-block.util";
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

  await finalizeStreamingForCurrentAssistant(chatId, sessionRuntime, buffer, {
    suppressBroadcast: suppressReplayBroadcast,
  });

  const { sessionUpdate: _sessionUpdate, ...toolCall } = update;
  const sanitizedToolCall: acp.ToolCall = {
    ...toolCall,
    kind: toolCall.kind ?? TOOL_CALL_FALLBACK_KIND,
    content: toStoredToolCallContent(toolCall.content),
  };
  const session = sessionRuntime.get(chatId);
  if (session) {
    session.toolCalls.set(update.toolCallId, sanitizedToolCall);
  }
  if (session) {
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
    });
    const messageWithLocations = sanitizedToolCall.locations?.length
      ? upsertToolLocationsPart({
          state: session.uiState,
          toolCallId: sanitizedToolCall.toolCallId,
          locations: sanitizedToolCall.locations,
          messageId: message.id,
        })
      : message;
    if (!suppressReplayBroadcast) {
      const nextToolIndex = session.uiState.toolPartIndex.get(
        update.toolCallId
      );
      if (nextToolIndex && nextToolIndex.messageId === message.id) {
        await broadcastUiMessagePart({
          chatId,
          sessionRuntime,
          message,
          partIndex: nextToolIndex.partIndex,
          isNew:
            !previousToolIndex ||
            previousToolIndex.messageId !== nextToolIndex.messageId ||
            previousToolIndex.partIndex !== nextToolIndex.partIndex,
        });
      }
      const locationPartIndex = findToolLocationsPartIndex(
        messageWithLocations ?? message,
        update.toolCallId
      );
      if (locationPartIndex >= 0) {
        await broadcastUiMessagePart({
          chatId,
          sessionRuntime,
          message: messageWithLocations ?? message,
          partIndex: locationPartIndex,
          isNew: previousLocationPartIndex < 0,
        });
      }
    }
  }
  return true;
}

export async function handleToolCallUpdate(
  context: Pick<
    SessionUpdateContext,
    | "chatId"
    | "update"
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

  await finalizeStreamingForCurrentAssistant(chatId, sessionRuntime, buffer, {
    suppressBroadcast: suppressReplayBroadcast,
  });

  const session = sessionRuntime.get(chatId);
  if (session) {
    const existing = session.toolCalls.get(update.toolCallId);
    const mergedToolCall = existing
      ? mergeToolCallUpdate(existing, update)
      : createToolCallFromUpdate(update);
    session.toolCalls.set(update.toolCallId, mergedToolCall);
  }

  if (session) {
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
    if (!suppressReplayBroadcast) {
      const nextToolIndex = session.uiState.toolPartIndex.get(
        update.toolCallId
      );
      if (nextToolIndex && nextToolIndex.messageId === message.id) {
        await broadcastUiMessagePart({
          chatId,
          sessionRuntime,
          message,
          partIndex: nextToolIndex.partIndex,
          isNew:
            !previousToolIndex ||
            previousToolIndex.messageId !== nextToolIndex.messageId ||
            previousToolIndex.partIndex !== nextToolIndex.partIndex,
        });
      }
      const locationPartIndex = findToolLocationsPartIndex(
        messageWithLocations ?? message,
        update.toolCallId
      );
      if (locationPartIndex >= 0) {
        await broadcastUiMessagePart({
          chatId,
          sessionRuntime,
          message: messageWithLocations ?? message,
          partIndex: locationPartIndex,
          isNew: previousLocationPartIndex < 0,
        });
      }
    }
  }
  return true;
}

function mergeToolCallUpdate(
  existing: acp.ToolCall,
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>
): acp.ToolCall {
  const mergedContent = resolveToolCallUpdateContent(
    existing.content,
    update.content
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
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>
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
    content: resolveToolCallUpdateContent(undefined, update.content),
    locations: resolvedLocations,
    _meta: update._meta ?? undefined,
  };
}

function resolveToolCallUpdateContent(
  existing: acp.ToolCall["content"],
  incoming: acp.ToolCallUpdate["content"]
): acp.ToolCall["content"] {
  if (incoming === undefined) {
    return existing;
  }
  if (incoming === null) {
    return undefined;
  }
  return toStoredToolCallContent(incoming);
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
