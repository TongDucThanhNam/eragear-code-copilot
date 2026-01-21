import type { ChildProcess } from "node:child_process";
import type { EventEmitter } from "node:events";
import type * as acp from "@agentclientprotocol/sdk";
import type { ClientSideConnection } from "@agentclientprotocol/sdk";
import type { SessionBuffering } from "../acp/protocol/update";

// Chat session state
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

export type BroadcastEvent =
  | { type: "connected" } // Sent immediately when client subscribes
  | { type: "current_mode_update"; modeId: string }
  | { type: "session_update"; update: unknown }
  | {
      type: "request_permission";
      requestId: string;
      toolCall: unknown;
      options?: unknown;
    }
  | { type: "user_message"; id: string; text: string; timestamp: number } // User message for replay
  | { type: "message"; message: unknown }
  | { type: "heartbeat"; ts: number }
  | { type: "error"; error: string }
  | { type: "terminal_output"; terminalId: string; data: string };

export interface AvailableCommand {
  name: string;
  description: string;
  input?: { hint: string } | null;
}

export interface AgentInfo {
  name?: string;
  title?: string;
  version?: string;
}

// Agent's prompt capabilities from initialize response
export interface PromptCapabilities {
  image?: boolean;
  audio?: boolean;
  embeddedContext?: boolean;
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
  }) => void)[]; // Support multiple waiters
}

export interface ChatSession {
  id: string;
  proc: ChildProcess;
  conn: ClientSideConnection;
  projectRoot: string;
  sessionId?: string; // ACP session ID
  loadSessionSupported?: boolean;
  modes?: SessionModeState;
  models?: SessionModelState;
  commands?: AvailableCommand[];
  agentInfo?: AgentInfo;
  promptCapabilities?: PromptCapabilities; // What content types agent accepts

  // New: Event Emitter for tRPC subscriptions
  emitter: EventEmitter;

  cwd: string; // The current working directory for this session

  subscriberCount: number; // Track number of active subscribers
  cleanupTimer?: ReturnType<typeof setTimeout>;
  messageBuffer: BroadcastEvent[];

  pendingPermissions: Map<
    string,
    {
      resolve: (decision: acp.RequestPermissionResponse) => void;
      options: acp.PermissionOption[];
    }
  >;

  terminals: Map<string, TerminalState>;

  // Session buffering for accumulating agent messages
  buffer?: SessionBuffering;
}

export type ConnWithUnstableModel = ClientSideConnection & {
  unstable_setSessionModel: (params: {
    sessionId: string;
    modelId: string;
  }) => Promise<void>;
};
