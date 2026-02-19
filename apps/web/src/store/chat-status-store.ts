import { create } from "zustand";

export type SessionBootstrapPhase =
  | "idle"
  | "creating_session"
  | "initializing_agent"
  | "restoring_history";

type ChatStatusState = {
  activeChatId: string | null;
  isStreaming: boolean;
  sessionBootstrapPhase: SessionBootstrapPhase;
  setActiveChatId: (chatId: string | null) => void;
  setIsStreaming: (isStreaming: boolean) => void;
  setSessionBootstrapPhase: (phase: SessionBootstrapPhase) => void;
};

export const useChatStatusStore = create<ChatStatusState>((set) => ({
  activeChatId: null,
  isStreaming: false,
  sessionBootstrapPhase: "idle",
  setActiveChatId: (chatId) => set({ activeChatId: chatId }),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  setSessionBootstrapPhase: (phase) => set({ sessionBootstrapPhase: phase }),
}));
