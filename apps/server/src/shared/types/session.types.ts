import type { ChildProcess } from "node:child_process";
import type { EventEmitter } from "node:events";
import type { ClientSideConnection } from "@agentclientprotocol/sdk";
import type { AgentInfo as DomainAgentInfo } from "./agent.types";

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolCalls?: Array<{ name: string; args: unknown }>;
  reasoning?: string;
}

export interface SessionModeState {
  currentModeId: string;
  availableModes: Array<{
    id: string;
    name: string;
    description?: string | null;
  }>;
}

export interface SessionModelState {
  currentModelId: string;
  availableModels: Array<{
    modelId: string;
    name: string;
    description?: string | null;
  }>;
}

export interface PromptCapabilities {
  image?: boolean;
  audio?: boolean;
  embeddedContext?: boolean;
}

export interface AvailableCommand {
  name: string;
  description: string;
  input?: { hint: string } | null;
}

export type BroadcastEvent =
  | { type: "connected" }
  | { type: "current_mode_update"; modeId: string }
  | { type: "session_update"; update: unknown }
  | {
      type: "request_permission";
      requestId: string;
      toolCall: unknown;
      options?: unknown;
    }
  | { type: "user_message"; id: string; text: string; timestamp: number }
  | { type: "message"; message: unknown }
  | { type: "heartbeat"; ts: number }
  | { type: "error"; error: string }
  | { type: "terminal_output"; terminalId: string; data: string };

export interface StoredSession {
  id: string;
  name?: string;
  sessionId?: string;
  projectId?: string;
  projectRoot: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  loadSessionSupported?: boolean;
  agentInfo?: DomainAgentInfo;
  status: "running" | "stopped";
  pinned?: boolean;
  archived?: boolean;
  createdAt: number;
  lastActiveAt: number;
  modeId?: string;
  modelId?: string;
  messages: StoredMessage[];
}

export interface ChatSession {
  id: string;
  proc: ChildProcess;
  conn: ClientSideConnection;
  projectId?: string;
  projectRoot: string;
  sessionId?: string;
  loadSessionSupported?: boolean;
  modes?: SessionModeState;
  models?: SessionModelState;
  commands?: AvailableCommand[];
  agentInfo?: DomainAgentInfo;
  promptCapabilities?: PromptCapabilities;
  emitter: EventEmitter;
  cwd: string;
  subscriberCount: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  messageBuffer: BroadcastEvent[];
  pendingPermissions: Map<
    string,
    { resolve: (decision: any) => void; options: any[] }
  >;
  terminals: Map<string, any>;
  buffer?: any;
}

export interface TerminalState {
  id: string;
  process: ChildProcess;
  outputBuffer: string;
  outputByteLimit?: number;
  truncated?: boolean;
  exitStatus?: { exitCode: number | null; signal: string | null };
  resolveExit: ((status: {
    exitCode: number | null;
    signal: string | null;
  }) => void)[];
}
