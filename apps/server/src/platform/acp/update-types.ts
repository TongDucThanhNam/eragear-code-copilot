import type * as acp from "@agentclientprotocol/sdk";

/** Legacy session update types for backward compatibility */
export interface LegacySessionUpdate {
  sessionUpdate: "turn_end" | "prompt_end";
}

/** Combined session update type including legacy updates */
export type SessionUpdateWithLegacy = acp.SessionUpdate | LegacySessionUpdate;

export function isToolCallUpdate(
  update: SessionUpdateWithLegacy
): update is acp.ToolCallUpdate & { sessionUpdate: "tool_call_update" } {
  return update.sessionUpdate === "tool_call_update";
}

export function isToolCallCreate(
  update: SessionUpdateWithLegacy
): update is acp.ToolCall & { sessionUpdate: "tool_call" } {
  return update.sessionUpdate === "tool_call";
}

export function isReplayChunk(update: SessionUpdateWithLegacy) {
  return (
    update.sessionUpdate === "user_message_chunk" ||
    update.sessionUpdate === "agent_message_chunk" ||
    update.sessionUpdate === "agent_thought_chunk"
  );
}

export function isTurnBoundaryUpdate(
  update: SessionUpdateWithLegacy
): update is LegacySessionUpdate {
  return (
    update.sessionUpdate === "turn_end" || update.sessionUpdate === "prompt_end"
  );
}
