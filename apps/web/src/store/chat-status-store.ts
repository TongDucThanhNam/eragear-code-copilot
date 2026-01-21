import { create } from "zustand";

type ChatStatusState = {
  activeChatId: string | null;
  isStreaming: boolean;
  setActiveChatId: (chatId: string | null) => void;
  setIsStreaming: (isStreaming: boolean) => void;
};

export const useChatStatusStore = create<ChatStatusState>((set) => ({
  activeChatId: null,
  isStreaming: false,
  setActiveChatId: (chatId) => set({ activeChatId: chatId }),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
}));
