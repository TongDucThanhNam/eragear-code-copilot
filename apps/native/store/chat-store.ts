import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  compareUiMessagesChronologically,
  findUiMessageInsertIndex,
  type AgentInfo,
  type ChatStatus,
  type UIMessage,
} from "@repo/shared";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Types matching the server's state
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

export interface SessionInfo {
  id: string;
  sessionId?: string;
  projectId?: string | null;
  projectRoot: string;
  modeId?: string;
  agentInfo?: {
    name?: string;
    title?: string;
    version?: string;
  };
  agentName?: string;
  status: "running" | "stopped" | "error";
  isActive?: boolean; // true = ACP session still alive, can reconnect
  loadSessionSupported?: boolean;
  createdAt?: number;
  lastActiveAt?: number;
}

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

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

interface ChatState {
  // Sessions
  sessions: SessionInfo[];
  activeChatId: string | null;
  activeChatIsReadOnly: boolean;
  failedChatIds: Set<string>; // Track sessions that failed to connect

  // Current chat state
  messageIds: string[];
  messagesById: Map<string, UIMessage>;
  status: ChatStatus;

  // Session capabilities
  modes: SessionModeState | null;
  models: SessionModelState | null;
  supportsModelSwitching: boolean;
  commands: AvailableCommand[];
  promptCapabilities: PromptCapabilities | null;
  agentInfo: AgentInfo | null;
  loadSessionSupported: boolean | undefined;

  // Permission
  pendingPermission: PermissionRequest | null;

  // Terminal output
  terminalOutput: Map<string, string>;

  // Connection
  connStatus: ConnectionStatus;
  error: string | null;

  // Actions
  setSessions: (sessions: SessionInfo[]) => void;
  setActiveChatId: (id: string | null, readOnly?: boolean) => void;
  addSession: (session: SessionInfo) => void;
  updateSessionStatus: (id: string, status: SessionInfo["status"]) => void;
  removeSession: (id: string) => void;

  setMessages: (messages: UIMessage[]) => void;
  upsertMessage: (message: UIMessage) => void;
  getMessageById: (id: string) => UIMessage | undefined;
  getMessagesForPermission: () => Iterable<UIMessage>;
  clearSessionView: () => void;

  setStatus: (status: ChatStatus) => void;
  setModes: (modes: SessionModeState | null) => void;
  setModels: (models: SessionModelState | null) => void;
  setSupportsModelSwitching: (supported: boolean) => void;
  setCommands: (commands: AvailableCommand[]) => void;
  setPromptCapabilities: (capabilities: PromptCapabilities | null) => void;
  setAgentInfo: (info: AgentInfo | null) => void;
  setLoadSessionSupported: (supported: boolean | undefined) => void;

  setPendingPermission: (permission: PermissionRequest | null) => void;

  appendTerminalOutput: (terminalId: string, data: string) => void;
  clearTerminalOutput: (terminalId: string) => void;

  setConnStatus: (status: ConnectionStatus) => void;
  setError: (error: string | null) => void;

  markChatFailed: (chatId: string) => void;
  isChatFailed: (chatId: string) => boolean;
  clearChatFailed: (chatId: string) => void;

  reset: () => void;
}

const initialState = {
  sessions: [],
  activeChatId: null,
  activeChatIsReadOnly: false,
  failedChatIds: new Set<string>(),
  messageIds: [],
  messagesById: new Map<string, UIMessage>(),
  status: "inactive" as ChatStatus,
  modes: null,
  models: null,
  supportsModelSwitching: false,
  commands: [],
  promptCapabilities: null,
  agentInfo: null,
  loadSessionSupported: undefined,
  pendingPermission: null,
  terminalOutput: new Map<string, string>(),
  connStatus: "idle" as ConnectionStatus,
  error: null,
};

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setSessions: (sessions) => set({ sessions }),

      setActiveChatId: (id, readOnly = false) =>
        set((state) => {
          if (
            state.activeChatId === id &&
            state.activeChatIsReadOnly === readOnly
          ) {
            return state;
          }
          const nextConnStatus =
            id && !readOnly ? ("connecting" as ConnectionStatus) : "idle";
          const nextStatus: ChatStatus =
            id && !readOnly ? "connecting" : "inactive";
          const isReadOnlyTransition =
            Boolean(id) &&
            state.activeChatId === id &&
            state.activeChatIsReadOnly !== readOnly;
          return {
            activeChatId: id,
            activeChatIsReadOnly: readOnly,
            messageIds: isReadOnlyTransition ? state.messageIds : [],
            messagesById: isReadOnlyTransition
              ? state.messagesById
              : new Map<string, UIMessage>(),
            status: nextStatus,
            modes: null,
            models: null,
            supportsModelSwitching: false,
            commands: [],
            promptCapabilities: null,
            agentInfo: null,
            loadSessionSupported: undefined,
            pendingPermission: null,
            terminalOutput: isReadOnlyTransition
              ? state.terminalOutput
              : new Map(),
            error: null,
            connStatus: nextConnStatus,
          };
        }),

      addSession: (session) =>
        set((state) => ({
          sessions: [
            ...state.sessions.filter((s) => s.id !== session.id),
            session,
          ],
        })),

      updateSessionStatus: (id, status) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, status } : s
          ),
        })),

      removeSession: (id) =>
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== id),
          activeChatId: state.activeChatId === id ? null : state.activeChatId,
        })),

      setMessages: (messages) =>
        set(() => {
          const sortedMessages = [...messages].sort((left, right) =>
            compareUiMessagesChronologically(left, right)
          );
          const messageIds: string[] = [];
          const messagesById = new Map<string, UIMessage>();
          for (const message of sortedMessages) {
            messageIds.push(message.id);
            messagesById.set(message.id, message);
          }
          return { messageIds, messagesById };
        }),
      upsertMessage: (message) =>
        set((state) => {
          const exists = state.messagesById.has(message.id);
          const current = state.messagesById.get(message.id);
          if (exists && current === message) {
            return state;
          }
          const nextMap = new Map(state.messagesById);
          nextMap.set(message.id, message);
          if (exists) {
            return { messagesById: nextMap };
          }
          const orderedMessages = state.messageIds
            .map((messageId) => state.messagesById.get(messageId))
            .filter((value): value is UIMessage => Boolean(value));
          const insertIndex = findUiMessageInsertIndex(orderedMessages, message);
          const nextIds = [...state.messageIds];
          nextIds.splice(insertIndex, 0, message.id);
          return {
            messagesById: nextMap,
            messageIds: nextIds,
          };
        }),
      getMessageById: (id) => get().messagesById.get(id),
      getMessagesForPermission: () => get().messagesById.values(),

      clearSessionView: () =>
        set({
          messageIds: [],
          messagesById: new Map<string, UIMessage>(),
          terminalOutput: new Map(),
          pendingPermission: null,
        }),

      setStatus: (status) => set({ status }),
      setModes: (modes) => set({ modes }),
      setModels: (models) => set({ models }),
      setSupportsModelSwitching: (supported) =>
        set({ supportsModelSwitching: supported }),
      setCommands: (commands) => set({ commands }),
      setPromptCapabilities: (capabilities) =>
        set({ promptCapabilities: capabilities }),
      setAgentInfo: (info) => set({ agentInfo: info }),
      setLoadSessionSupported: (supported) =>
        set({ loadSessionSupported: supported }),

      setPendingPermission: (permission) =>
        set({ pendingPermission: permission }),

      appendTerminalOutput: (terminalId, data) =>
        set((state) => {
          const newMap = new Map(state.terminalOutput);
          const current = newMap.get(terminalId) || "";
          newMap.set(terminalId, current + data);
          return { terminalOutput: newMap };
        }),

      clearTerminalOutput: (terminalId) =>
        set((state) => {
          const newMap = new Map(state.terminalOutput);
          newMap.delete(terminalId);
          return { terminalOutput: newMap };
        }),

      setConnStatus: (status) => set({ connStatus: status }),
      setError: (error) => set({ error }),

      markChatFailed: (chatId) =>
        set((state) => {
          const newFailed = new Set(state.failedChatIds);
          newFailed.add(chatId);
          return {
            failedChatIds: newFailed,
            // Also remove from sessions list since it's invalid
            sessions: state.sessions.filter((s) => s.id !== chatId),
          };
        }),

      isChatFailed: (chatId) => get().failedChatIds.has(chatId),
      clearChatFailed: (chatId) =>
        set((state) => {
          if (!state.failedChatIds.has(chatId)) {
            return state;
          }
          const newFailed = new Set(state.failedChatIds);
          newFailed.delete(chatId);
          return { failedChatIds: newFailed };
        }),

      reset: () => set(initialState),
    }),
    {
      name: "chat-storage",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        sessions: state.sessions,
        activeChatId: state.activeChatId,
        activeChatIsReadOnly: state.activeChatIsReadOnly,
      }),
    }
  )
);
