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
  UseChatOptions as SharedUseChatOptions,
  UIMessage,
} from "@repo/shared";

export type UseChatOptions = SharedUseChatOptions;

export interface SendMessageOptions {
  images?: { base64: string; mimeType: string }[];
  resources?: { uri: string; text: string; mimeType?: string }[];
  resourceLinks?: { uri: string; name: string; mimeType?: string }[];
}

export interface UseChatResult {
  messages: UIMessage[];
  status: ChatStatus;
  connStatus: ConnectionStatus;
  isStreaming: boolean;
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
  isSending: boolean;
  isCancelling: boolean;
  isResuming: boolean;
  hasMoreHistory: boolean;
  isLoadingOlderHistory: boolean;
  sendMessage: (text: string, options?: SendMessageOptions) => Promise<boolean>;
  cancelPrompt: () => Promise<void>;
  setMode: (modeId: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setConfigOption: (configId: string, value: string) => Promise<void>;
  respondToPermission: (requestId: string, decision: string) => Promise<void>;
  stopSession: () => Promise<void>;
  resumeSession: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  loadOlderHistory: () => Promise<void>;
  upsertMessage: (message: UIMessage) => void;
  setMessages: (messages: UIMessage[]) => void;
  restoreSessionState: (state: SessionStateData) => void;
  setConnStatus: (status: ConnectionStatus) => void;
  setStatus: (status: ChatStatus) => void;
}
