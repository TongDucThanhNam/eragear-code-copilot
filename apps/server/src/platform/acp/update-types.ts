import type * as acp from "@agentclientprotocol/sdk";
import type {
  SessionBufferingPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import type { TurnIdResolution } from "./update-turn-id";

type AcpCurrentModeUpdate = Extract<
  acp.SessionUpdate,
  { sessionUpdate: "current_mode_update" }
>;

export type SessionUpdate =
  | Exclude<acp.SessionUpdate, AcpCurrentModeUpdate>
  | (AcpCurrentModeUpdate & {
      reason?: string;
      metadata?: unknown;
    });

export interface SessionUpdateContext {
  chatId: string;
  buffer: SessionBufferingPort;
  isReplayingHistory: boolean;
  suppressReplayBroadcast: boolean;
  update: SessionUpdate;
  turnIdResolution: TurnIdResolution;
  sessionRuntime: SessionRuntimePort;
  sessionRepo: SessionRepositoryPort;
  finalizeStreamingForCurrentAssistant: (
    chatId: string,
    sessionRuntime: SessionRuntimePort,
    buffer: SessionBufferingPort,
    options?: {
      suppressBroadcast?: boolean;
    }
  ) => Promise<void>;
}

export function isToolCallUpdate(
  update: SessionUpdate
): update is acp.ToolCallUpdate & { sessionUpdate: "tool_call_update" } {
  return update.sessionUpdate === "tool_call_update";
}

export function isToolCallCreate(
  update: SessionUpdate
): update is acp.ToolCall & { sessionUpdate: "tool_call" } {
  return update.sessionUpdate === "tool_call";
}

export function isReplayChunk(update: SessionUpdate) {
  return (
    update.sessionUpdate === "user_message_chunk" ||
    update.sessionUpdate === "agent_message_chunk" ||
    update.sessionUpdate === "agent_thought_chunk"
  );
}
