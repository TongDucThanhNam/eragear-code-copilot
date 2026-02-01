import AsyncStorage from "@react-native-async-storage/async-storage";
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

// Message part types matching ACP format
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; toolCallId: string; name: string; args: unknown }
  | {
      type: "tool_result";
      toolCallId: string;
      status: string;
      content?: Array<{
        type: string;
        text?: string;
        source?: {
          type: string;
          text?: string;
          oldText?: string;
          path?: string;
        };
      }>;
    }
  | { type: "plan"; items: Array<{ content: string; status: string }> }
  | {
      type: "diff";
      path: string;
      oldText?: string;
      newText: string;
    }
  | { type: "terminal"; terminalId: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  timestamp: number;
}

// Tool call types matching ACP protocol
export interface ToolCall {
  kind?: string;
  title: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  status?: "pending" | "in_progress" | "completed" | "failed";
  locations?: Array<{ path: string; line?: number }>;
  content?: Array<{
    type: string;
    text?: string;
    source?: {
      type: string;
      text?: string;
      oldText?: string;
      path?: string;
    };
  }>;
  _meta?: Record<string, unknown>;
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
  toolCall: ToolCall;
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
  messages: ChatMessage[];
  pendingText: string; // Streaming text buffer
  pendingReasoning: string; // Streaming reasoning buffer

  // Session capabilities
  modes: SessionModeState | null;
  models: SessionModelState | null;
  supportsModelSwitching: boolean;
  commands: AvailableCommand[];
  promptCapabilities: PromptCapabilities | null;

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

  addMessage: (message: ChatMessage) => void;
  updateLastAssistantMessage: (parts: MessagePart[]) => void;
  appendToText: (text: string) => void;
  appendToUserText: (text: string) => void;
  appendToReasoning: (text: string) => void;
  flushPending: () => void;
  clearMessages: () => void;
  clearSessionView: () => void;

  setModes: (modes: SessionModeState | null) => void;
  setModels: (models: SessionModelState | null) => void;
  setSupportsModelSwitching: (supported: boolean) => void;
  setCommands: (commands: AvailableCommand[]) => void;
  setPromptCapabilities: (capabilities: PromptCapabilities | null) => void;

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
  messages: [],
  pendingText: "",
  pendingReasoning: "",
  modes: null,
  models: null,
  supportsModelSwitching: false,
  commands: [],
  promptCapabilities: null,
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
          const isReadOnlyTransition =
            Boolean(id) &&
            state.activeChatId === id &&
            state.activeChatIsReadOnly !== readOnly;
          return {
            activeChatId: id,
            activeChatIsReadOnly: readOnly,
            messages: isReadOnlyTransition ? state.messages : [],
            pendingText: "",
            pendingReasoning: "",
            modes: null,
            models: null,
            supportsModelSwitching: false,
            commands: [],
            promptCapabilities: null,
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

      addMessage: (message) =>
        set((state) => ({ messages: [...state.messages, message] })),

      updateLastAssistantMessage: (parts) =>
        set((state) => {
          const messages = [...state.messages];
          const lastIdx = messages.length - 1;
          if (lastIdx >= 0 && messages[lastIdx].role === "assistant") {
            messages[lastIdx] = { ...messages[lastIdx], parts };
          }
          return { messages };
        }),

      appendToText: (text) =>
        set((state) => {
          const messages = [...state.messages];
          const lastMsg = messages.at(-1);

          if (lastMsg?.role === "assistant") {
            const parts = [...lastMsg.parts];
            const lastPart = parts.at(-1);
            if (lastPart?.type === "text") {
              parts[parts.length - 1] = {
                ...lastPart,
                text: lastPart.text + text,
              };
            } else {
              parts.push({ type: "text", text });
            }
            messages[messages.length - 1] = { ...lastMsg, parts };
          } else {
            messages.push({
              id: `msg_${Date.now()}`,
              role: "assistant",
              parts: [{ type: "text", text }],
              timestamp: Date.now(),
            });
          }

          return { messages };
        }),

      appendToUserText: (text) =>
        set((state) => {
          const messages = [...state.messages];
          const lastMsg = messages.at(-1);

          if (lastMsg?.role === "user") {
            const parts = [...lastMsg.parts];
            const lastPart = parts.at(-1);
            if (lastPart?.type === "text") {
              parts[parts.length - 1] = {
                ...lastPart,
                text: lastPart.text + text,
              };
            } else {
              parts.push({ type: "text", text });
            }
            messages[messages.length - 1] = { ...lastMsg, parts };
          } else {
            messages.push({
              id: `msg_${Date.now()}`,
              role: "user",
              parts: [{ type: "text", text }],
              timestamp: Date.now(),
            });
          }

          return { messages };
        }),

      appendToReasoning: (text) =>
        set((state) => {
          const messages = [...state.messages];
          const lastMsg = messages.at(-1);

          if (lastMsg?.role === "assistant") {
            const parts = [...lastMsg.parts];
            const lastPart = parts.at(-1);
            if (lastPart?.type === "reasoning") {
              parts[parts.length - 1] = {
                ...lastPart,
                text: lastPart.text + text,
              };
            } else {
              parts.push({ type: "reasoning", text });
            }
            messages[messages.length - 1] = { ...lastMsg, parts };
          } else {
            messages.push({
              id: `msg_${Date.now()}`,
              role: "assistant",
              parts: [{ type: "reasoning", text }],
              timestamp: Date.now(),
            });
          }

          return { messages };
        }),

      flushPending: () => {
        const { pendingText, pendingReasoning, messages } = get();
        if (!(pendingText || pendingReasoning)) {
          return;
        }

        const parts: MessagePart[] = [];
        if (pendingReasoning) {
          parts.push({ type: "reasoning", text: pendingReasoning });
        }
        if (pendingText) {
          parts.push({ type: "text", text: pendingText });
        }

        // Append to last assistant message or create new one
        const lastMsg = messages.at(-1);
        if (lastMsg?.role === "assistant") {
          set((state) => ({
            messages: state.messages.map((m, i) =>
              i === state.messages.length - 1
                ? { ...m, parts: [...m.parts, ...parts] }
                : m
            ),
            pendingText: "",
            pendingReasoning: "",
          }));
        } else {
          set((state) => ({
            messages: [
              ...state.messages,
              {
                id: `msg_${Date.now()}`,
                role: "assistant",
                parts,
                timestamp: Date.now(),
              },
            ],
            pendingText: "",
            pendingReasoning: "",
          }));
        }
      },

      clearMessages: () =>
        set({ messages: [], pendingText: "", pendingReasoning: "" }),
      clearSessionView: () =>
        set({
          messages: [],
          pendingText: "",
          pendingReasoning: "",
          terminalOutput: new Map(),
        }),

      setModes: (modes) => set({ modes }),
      setModels: (models) => set({ models }),
      setSupportsModelSwitching: (supported) =>
        set({ supportsModelSwitching: supported }),
      setCommands: (commands) => set({ commands }),
      setPromptCapabilities: (capabilities) =>
        set({ promptCapabilities: capabilities }),

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
