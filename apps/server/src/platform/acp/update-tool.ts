import type * as acp from "@agentclientprotocol/sdk";
import { toStoredToolCallContent } from "@/shared/utils/content-block.util";
import {
  buildToolPartForUpdate,
  buildToolPartFromCall,
  upsertToolLocationsPart,
  upsertToolPart,
} from "@/shared/utils/ui-message.util";
import type { SessionUpdate, SessionUpdateContext } from "./update-types";
import { isToolCallCreate, isToolCallUpdate } from "./update-types";

export function handleToolCallCreate(context: SessionUpdateContext) {
  const { chatId, update, sessionRuntime, finalizeStreamingForCurrentAssistant } =
    context;
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

export function handleToolCallUpdate(
  context: Pick<SessionUpdateContext, "chatId" | "update" | "sessionRuntime">
) {
  const { chatId, update, sessionRuntime } = context;
  if (!isToolCallUpdate(update)) {
    return false;
  }

  const session = sessionRuntime.get(chatId);
  if (session) {
    const existing = session.toolCalls.get(update.toolCallId);
    if (existing) {
      session.toolCalls.set(
        update.toolCallId,
        mergeToolCallUpdate(existing, update)
      );
    }
  }

  if (session) {
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
    sessionRuntime.broadcast(chatId, {
      type: "ui_message",
      message: messageWithLocations ?? message,
    });
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
    content: mergedContent,
    locations: mergedLocations,
    _meta: mergedMeta,
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
