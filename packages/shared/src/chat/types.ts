import type {
  DataUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
} from "../ui-message";

// ============================================================================
// Chat Status Types
// ============================================================================

/**
 * Chat status matching server's BroadcastEvent chat_status.
 *
 * Covers both session availability and prompt turn lifecycle.
 */
export type ChatStatus =
  | "inactive"
  | "connecting"
  | "ready"
  | "submitted"
  | "streaming"
  | "awaiting_permission"
  | "cancelling"
  | "error";

/** Connection status for subscription lifecycle */
export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

// ============================================================================
// Session State Types
// ============================================================================

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
    provider?: string;
    providers?: string[];
  }>;
}

export interface AvailableCommand {
  name: string;
  description: string;
  input?: { hint: string };
}

export interface PromptCapabilities {
  image?: boolean;
  audio?: boolean;
  embeddedContext?: boolean;
}

export interface AgentInfo {
  name: string;
  title?: string;
  version: string;
}

export type SessionConfigOptionCategory =
  | "mode"
  | "model"
  | "thought_level"
  | string;

export interface SessionConfigSelectOption {
  value: string;
  name: string;
  description?: string | null;
}

export interface SessionConfigSelectGroup {
  group: string;
  name: string;
  options: SessionConfigSelectOption[];
}

export interface SessionConfigOption {
  id: string;
  name: string;
  description?: string | null;
  category?: SessionConfigOptionCategory | null;
  type: "select";
  currentValue: string;
  options: SessionConfigSelectOption[] | SessionConfigSelectGroup[];
}

export interface SessionInfo {
  title?: string | null;
  updatedAt?: string | null;
}

// ============================================================================
// Permission Types
// ============================================================================

export interface PermissionOption {
  optionId?: string;
  id?: string;
  kind?: string;
  name?: string;
  label?: string;
  description?: string;
}

export type PermissionOptions =
  | PermissionOption[]
  | {
      allowOther?: boolean;
      options?: PermissionOption[];
    };

export interface PermissionRequest {
  requestId: string;
  toolCallId: string;
  title: string;
  input?: unknown;
  options?: PermissionOptions;
}

// ============================================================================
// Broadcast Event Types (matching server's BroadcastEvent)
// ============================================================================

export type BroadcastEvent =
  | { type: "connected" }
  | { type: "chat_status"; status: ChatStatus; turnId?: string }
  | {
      type: "chat_finish";
      stopReason: string;
      finishReason: string;
      messageId?: string;
      message?: UIMessage;
      isAbort: boolean;
      turnId?: string;
    }
  | { type: "ui_message"; message: UIMessage; turnId?: string }
  | {
      type: "ui_message_part";
      messageId: string;
      messageRole: UIMessage["role"];
      partId?: string;
      partIndex: number;
      part: UIMessagePart;
      isNew: boolean;
      createdAt?: number;
      turnId?: string;
    }
  | {
      type: "ui_message_part_removed";
      messageId: string;
      messageRole: UIMessage["role"];
      partId?: string;
      partIndex: number;
      part: UIMessagePart;
      turnId?: string;
    }
  | { type: "file_modified"; path: string }
  | {
      type: "available_commands_update";
      availableCommands: Array<{
        name: string;
        description: string;
        input?: { hint: string } | null;
      }>;
    }
  | {
      type: "config_options_update";
      configOptions: SessionConfigOption[];
    }
  | {
      type: "session_info_update";
      sessionInfo: SessionInfo;
    }
  | { type: "current_mode_update"; modeId: string }
  | { type: "current_model_update"; modelId: string }
  | {
      type: "terminal_output";
      terminalId: string;
      data: string;
      turnId?: string;
    }
  | { type: "heartbeat"; ts: number }
  | { type: "error"; error: string };

// ============================================================================
// useChat Hook Types
// ============================================================================

export interface UseChatOptions {
  chatId?: string | null;
  readOnly?: boolean;
  onFinish?: (payload: {
    stopReason: string;
    finishReason: string;
    messageId?: string;
    message?: UIMessage;
    isAbort: boolean;
    turnId?: string;
  }) => void;
  onError?: (message: string) => void;
}

export interface UseChatState {
  messages: UIMessage[];
  status: ChatStatus;
  connStatus: ConnectionStatus;
  pendingPermission: PermissionRequest | null;
  terminalOutputs: Record<string, string>;
  modes: SessionModeState | null;
  models: SessionModelState | null;
  supportsModelSwitching: boolean;
  commands: AvailableCommand[];
  configOptions: SessionConfigOption[];
  sessionInfo: SessionInfo | null;
  promptCapabilities: PromptCapabilities | null;
  agentInfo: AgentInfo | null;
  loadSessionSupported: boolean | undefined;
  error: string | null;
}

export interface UseChatActions {
  sendMessage: (
    text: string,
    options?: {
      images?: { base64: string; mimeType: string }[];
      resources?: { uri: string; text: string; mimeType?: string }[];
      resourceLinks?: { uri: string; name: string; mimeType?: string }[];
    }
  ) => Promise<boolean>;
  cancelPrompt: () => Promise<void>;
  setMode: (modeId: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setConfigOption: (configId: string, value: string) => Promise<void>;
  respondToPermission: (requestId: string, decision: string) => Promise<void>;
  stopSession: () => Promise<void>;
  resumeSession: (chatId: string) => Promise<unknown>;
}

// ============================================================================
// Type Guards
// ============================================================================

export const isToolPart = (part: UIMessagePart): part is ToolUIPart =>
  part.type.startsWith("tool-");

export const isDataPart = (
  part: UIMessagePart,
  type: string
): part is DataUIPart => part.type === type;
