import type {
  AgentInfo,
  AvailableCommand,
  ChatStatus,
  ConnectionStatus,
  PermissionRequest,
  PromptCapabilities,
  SessionConfigOption,
  SessionInfo,
  SessionModelState,
  SessionModeState,
  SessionStateData,
  SupervisorDecisionSummary,
  SupervisorSessionState,
  UseChatOptions as SharedUseChatOptions,
  UIMessage,
} from "@repo/shared";

export type UseChatOptions = SharedUseChatOptions;

export interface SendMessageOptions {
  images?: { base64: string; mimeType: string }[];
  resources?: { uri: string; text: string; mimeType?: string }[];
  resourceLinks?: { uri: string; name: string; mimeType?: string }[];
}

/**
 * Outcome of a sendMessage call.
 *
 * Returned synchronously so callers can inspect the error immediately
 * instead of waiting for a React state re-render (which would make
 * `error` stale when read in the same callback frame).
 */
export interface SendMessageOutcome {
  /** Whether the message was accepted by the server. */
  submitted: boolean;
  /**
   * When `submitted` is false, contains a human-readable reason.
   * `undefined` for silent rejections (e.g. duplicate submit guard).
   */
  error?: string;
}

export interface UseChatResult {
  messages: UIMessage[];
  status: ChatStatus;
  connStatus: ConnectionStatus;
  isStreaming: boolean;
  pendingPermission: PermissionRequest | null;
  modes: SessionModeState | null;
  models: SessionModelState | null;
  supportsModelSwitching: boolean;
  commands: AvailableCommand[];
  configOptions: SessionConfigOption[];
  sessionInfo: SessionInfo | null;
  supervisor: SupervisorSessionState | null;
  supervisorCapable: boolean;
  lastSupervisorDecision: SupervisorDecisionSummary | null;
  promptCapabilities: PromptCapabilities | null;
  agentInfo: AgentInfo | null;
  loadSessionSupported: boolean | undefined;
  error: string | null;
  isSending: boolean;
  isCancelling: boolean;
  isResuming: boolean;
  isSettingSupervisorMode: boolean;
  hasMoreHistory: boolean;
  isLoadingOlderHistory: boolean;
  sendMessage: (
    text: string,
    options?: SendMessageOptions
  ) => Promise<SendMessageOutcome>;
  cancelPrompt: () => Promise<void>;
  setMode: (modeId: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setConfigOption: (configId: string, value: string) => Promise<void>;
  respondToPermission: (requestId: string, decision: string) => Promise<void>;
  stopSession: () => Promise<void>;
  resumeSession: () => Promise<void>;
  setSupervisorMode: (mode: "off" | "full_autopilot") => Promise<void>;
  refreshHistory: () => Promise<void>;
  loadOlderHistory: () => Promise<void>;
  upsertMessage: (message: UIMessage) => void;
  setMessages: (messages: UIMessage[]) => void;
  restoreSessionState: (state: SessionStateData) => void;
  setConnStatus: (status: ConnectionStatus) => void;
  setStatus: (status: ChatStatus) => void;
}
