/**
 * Session Types
 *
 * Type definitions for chat sessions, messages, plans, and runtime state.
 * Includes both stored data structures and active runtime representations.
 *
 * @module shared/types/session.types
 */

import type { ChildProcess } from "node:child_process";
import type { EventEmitter } from "node:events";
import type {
  AudioContent,
  ClientSideConnection,
  EmbeddedResource,
  ImageContent,
  ResourceLink,
  TextContent,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import type { AgentInfo as DomainAgentInfo } from "./agent.types";

// ============================================================================
// Stored Types (Persisted)
// ============================================================================

/**
 * A message stored in a session's history
 */
export interface StoredMessage {
  /** Unique identifier for the message */
  id: string;
  /** Role of the message sender */
  role: "user" | "assistant";
  /** Text content of the message */
  content: string;
  /** Structured content blocks for the message */
  contentBlocks?: StoredContentBlock[];
  /** Timestamp when the message was created */
  timestamp: number;
  /** Optional tool calls made during this message */
  toolCalls?: Array<{ name: string; args: unknown }>;
  /** Optional reasoning content from the agent */
  reasoning?: string;
  /** Optional structured reasoning blocks */
  reasoningBlocks?: StoredContentBlock[];
}

/**
 * JSON-safe representation of ACP ContentBlock for storage
 * (normalizes BigInt fields to numbers when possible).
 */
export type StoredContentBlock =
  | (TextContent & { type: "text" })
  | (ImageContent & { type: "image" })
  | (AudioContent & { type: "audio" })
  | (EmbeddedResource & { type: "resource" })
  | (Omit<ResourceLink, "size"> & {
      type: "resource_link";
      size?: number | null;
    });

/**
 * Session mode state information
 */
export interface SessionModeState {
  /** Currently active mode identifier */
  currentModeId: string;
  /** List of available modes */
  availableModes: Array<{
    /** Mode identifier */
    id: string;
    /** Display name of the mode */
    name: string;
    /** Optional description of the mode */
    description?: string | null;
  }>;
}

/**
 * Session model state information
 */
export interface SessionModelState {
  /** Currently active model identifier */
  currentModelId: string;
  /** List of available models */
  availableModels: Array<{
    /** Model identifier */
    modelId: string;
    /** Display name of the model */
    name: string;
    /** Optional description of the model */
    description?: string | null;
  }>;
}

/**
 * Capabilities for prompt input types
 */
export interface PromptCapabilities {
  /** Whether image input is supported */
  image?: boolean;
  /** Whether audio input is supported */
  audio?: boolean;
  /** Whether embedded context is supported */
  embeddedContext?: boolean;
}

/**
 * Buffer for accumulating streaming content
 */
export interface SessionBuffer {
  /** Number of replay events */
  replayEventCount: number;
  /** Append content block to the buffer */
  appendContent(block: StoredContentBlock): void;
  /** Append reasoning block to the buffer */
  appendReasoning(block: StoredContentBlock): void;
  /** Flush and return the accumulated message, or null if empty */
  flush(): {
    id: string;
    content: string;
    contentBlocks: StoredContentBlock[];
    reasoning?: string;
    reasoningBlocks?: StoredContentBlock[];
  } | null;
  /** Check if buffer has accumulated content */
  hasContent(): boolean;
  /** Reset the buffer */
  reset(): void;
}

/**
 * Available command in a session
 */
export interface AvailableCommand {
  /** Command name */
  name: string;
  /** Command description */
  description: string;
  /** Optional input hints */
  input?: { hint: string } | null;
}

/**
 * Priority levels for plan entries
 */
export type PlanEntryPriority = "high" | "medium" | "low";

/**
 * Status values for plan entries
 */
export type PlanEntryStatus = "pending" | "in_progress" | "completed";

/**
 * A single entry in a plan
 */
export interface PlanEntry {
  /** Optional metadata */
  _meta?: Record<string, unknown> | null;
  /** Content/description of the entry */
  content: string;
  /** Priority level */
  priority: PlanEntryPriority;
  /** Current status */
  status: PlanEntryStatus;
}

/**
 * A plan containing multiple entries
 */
export interface Plan {
  /** Optional metadata */
  _meta?: Record<string, unknown> | null;
  /** List of plan entries */
  entries: PlanEntry[];
}

/**
 * Union type for all broadcast events to clients
 */
export type BroadcastEvent =
  | { type: "connected" }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "tool_call_update"; toolCall: ToolCallUpdate }
  | { type: "current_mode_update"; modeId: string }
  | { type: "session_update"; update: unknown }
  | { type: "plan_update"; plan: Plan }
  | {
      type: "request_permission";
      requestId: string;
      toolCall: unknown;
      options?: unknown;
    }
  | {
      type: "user_message";
      id: string;
      text: string;
      timestamp: number;
      contentBlocks?: StoredContentBlock[];
    }
  | { type: "message"; message: unknown }
  | { type: "heartbeat"; ts: number }
  | { type: "error"; error: string }
  | { type: "terminal_output"; terminalId: string; data: string };

/**
 * A session stored in persistent storage
 */
export interface StoredSession {
  /** Unique identifier */
  id: string;
  /** Optional display name */
  name?: string;
  /** Active session ID from the agent process */
  sessionId?: string;
  /** Associated project ID */
  projectId?: string;
  /** Project root directory */
  projectRoot: string;
  /** Command used to spawn the agent */
  command?: string;
  /** Arguments for the agent command */
  args?: string[];
  /** Environment variables for the agent */
  env?: Record<string, string>;
  /** Working directory for the agent */
  cwd?: string;
  /** Whether load session is supported */
  loadSessionSupported?: boolean;
  /** Whether to use unstable_resumeSession instead of loadSession */
  useUnstableResume?: boolean;
  /** Whether agent supports runtime model switching (session/set_model method) */
  supportsModelSwitching?: boolean;
  /** Agent metadata */
  agentInfo?: DomainAgentInfo;
  /** Current session status */
  status: "running" | "stopped";
  /** Whether the session is pinned */
  pinned?: boolean;
  /** Whether the session is archived */
  archived?: boolean;
  /** Creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActiveAt: number;
  /** Current mode identifier */
  modeId?: string;
  /** Current model identifier */
  modelId?: string;
  /** Message history */
  messages: StoredMessage[];
  /** Current plan */
  plan?: Plan;
  /** Available commands */
  commands?: AvailableCommand[];
  /** Full agent capabilities from initialize response */
  agentCapabilities?: Record<string, unknown>;
  /** Authentication methods supported by the agent */
  authMethods?: Array<{ name: string; id: string; description: string }>;
}

// ============================================================================
// Runtime Types (Active Sessions)
// ============================================================================

/**
 * An active chat session in memory
 */
export interface ChatSession {
  /** Session identifier */
  id: string;
  /** Child process for the agent */
  proc: ChildProcess;
  /** ACP connection to the agent */
  conn: ClientSideConnection;
  /** Associated project ID */
  projectId?: string;
  /** Project root directory */
  projectRoot: string;
  /** Active session ID from the agent */
  sessionId?: string;
  /** Whether load session is supported */
  loadSessionSupported?: boolean;
  /** Whether to use unstable_resumeSession instead of loadSession */
  useUnstableResume?: boolean;
  /** Whether agent supports runtime model switching (session/set_model method) */
  supportsModelSwitching?: boolean;
  /** Current mode state */
  modes?: SessionModeState;
  /** Current model state */
  models?: SessionModelState;
  /** Available commands */
  commands?: AvailableCommand[];
  /** Agent metadata */
  agentInfo?: DomainAgentInfo;
  /** Prompt capabilities */
  promptCapabilities?: PromptCapabilities;
  /** Current plan */
  plan?: Plan;
  /** Event emitter for session events */
  emitter: EventEmitter;
  /** Current working directory */
  cwd: string;
  /** Number of subscribers */
  subscriberCount: number;
  /** Timer for cleanup */
  cleanupTimer?: ReturnType<typeof setTimeout>;
  /** Buffer for broadcast events */
  messageBuffer: BroadcastEvent[];
  /** Pending permission requests */
  pendingPermissions: Map<
    string,
    { resolve: (decision: unknown) => void; options: unknown[] }
  >;
  /** Active tool calls */
  toolCalls: Map<string, ToolCall>;
  /** Active terminals */
  terminals: Map<string, unknown>;
  /** Message buffer for streaming */
  buffer?: SessionBuffer;
  /** Full agent capabilities from initialize response */
  agentCapabilities?: Record<string, unknown>;
  /** Authentication methods supported by the agent */
  authMethods?: Array<{ name: string; id: string; description: string }>;
}

/**
 * Terminal state for managed terminals
 */
export interface TerminalState {
  /** Terminal identifier */
  id: string;
  /** Terminal process */
  process: ChildProcess;
  /** Output buffer */
  outputBuffer: string;
  /** Output buffer bytes for accurate byte-limit truncation */
  outputBufferBytes?: Buffer;
  /** Optional byte limit for output */
  outputByteLimit?: number;
  /** Whether output was truncated */
  truncated?: boolean;
  /** Exit status, if available */
  exitStatus?: { exitCode: number | null; signal: string | null };
  /** Optional kill timer for enforcing terminal timeouts */
  killTimer?: ReturnType<typeof setTimeout>;
  /** Promise resolvers for exit status */
  resolveExit: ((status: {
    exitCode: number | null;
    signal: string | null;
  }) => void)[];
}
