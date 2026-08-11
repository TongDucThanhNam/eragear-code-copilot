import type { TurnDiffFile } from "@eragear-code-copilot/shared";
import { create } from "zustand";

export interface ChatTurnDiff {
  turnId: string;
  turnCount: number;
  files: TurnDiffFile[];
}

interface ChatTurnDiffStore {
  byChatId: Record<string, Record<string, ChatTurnDiff>>;
  turnIdByMessageId: Record<string, Record<string, string>>;
  setTurnDiff: (chatId: string, diff: ChatTurnDiff) => void;
  linkTurnMessage: (chatId: string, messageId: string, turnId: string) => void;
  clearChat: (chatId: string) => void;
}

export const useChatTurnDiffStore = create<ChatTurnDiffStore>((set) => ({
  byChatId: {},
  turnIdByMessageId: {},
  setTurnDiff: (chatId, diff) =>
    set((state) => ({
      byChatId: {
        ...state.byChatId,
        [chatId]: {
          ...state.byChatId[chatId],
          [diff.turnId]: diff,
        },
      },
    })),
  linkTurnMessage: (chatId, messageId, turnId) =>
    set((state) => ({
      turnIdByMessageId: {
        ...state.turnIdByMessageId,
        [chatId]: {
          ...state.turnIdByMessageId[chatId],
          [messageId]: turnId,
        },
      },
    })),
  clearChat: (chatId) =>
    set((state) => {
      const nextDiffs = { ...state.byChatId };
      const nextMessageLinks = { ...state.turnIdByMessageId };
      delete nextDiffs[chatId];
      delete nextMessageLinks[chatId];
      return {
        byChatId: nextDiffs,
        turnIdByMessageId: nextMessageLinks,
      };
    }),
}));
