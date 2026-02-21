import type { UIMessage } from "@repo/shared";
import { create } from "zustand";
import {
  createEmptyMessageState,
  type MessageState,
} from "@/hooks/use-chat-message-state";

const TERMINAL_OUTPUT_MAX_CHARS = 256 * 1024;
const EMPTY_MESSAGE_STATE: MessageState = createEmptyMessageState();
const EMPTY_MESSAGES: UIMessage[] = [];
const EMPTY_TERMINAL_OUTPUTS: Record<string, string> = {};

interface ChatStreamSnapshot {
  messageState: MessageState;
  terminalOutputs: Record<string, string>;
}

interface ChatStreamStore {
  byChatId: Record<string, ChatStreamSnapshot>;
  clearChat(chatId: string): void;
  getMessageState(chatId: string): MessageState;
  updateMessageState(
    chatId: string,
    updater: (prev: MessageState) => MessageState
  ): MessageState;
  setTerminalOutputs(
    chatId: string,
    terminalOutputs: Record<string, string>
  ): Record<string, string>;
  appendTerminalOutput(
    chatId: string,
    terminalId: string,
    data: string
  ): Record<string, string>;
  getTerminalOutputs(chatId: string): Record<string, string>;
}

function createSnapshot(): ChatStreamSnapshot {
  return {
    messageState: createEmptyMessageState(),
    terminalOutputs: {},
  };
}

function trimTerminalOutput(value: string): string {
  if (value.length <= TERMINAL_OUTPUT_MAX_CHARS) {
    return value;
  }
  const sliceStart = value.length - TERMINAL_OUTPUT_MAX_CHARS;
  const nextLineBreak = value.indexOf("\n", sliceStart);
  if (nextLineBreak >= 0 && nextLineBreak + 1 < value.length) {
    return value.slice(nextLineBreak + 1);
  }
  return value.slice(sliceStart);
}

export const useChatStreamStore = create<ChatStreamStore>((set, get) => ({
  byChatId: {},
  clearChat(chatId) {
    set((state) => {
      if (!(chatId in state.byChatId)) {
        return state;
      }
      const nextByChatId = { ...state.byChatId };
      delete nextByChatId[chatId];
      return { byChatId: nextByChatId };
    });
  },
  getMessageState(chatId) {
    return get().byChatId[chatId]?.messageState ?? EMPTY_MESSAGE_STATE;
  },
  updateMessageState(chatId, updater) {
    let resolved = get().byChatId[chatId]?.messageState ?? EMPTY_MESSAGE_STATE;
    set((state) => {
      const current = state.byChatId[chatId] ?? createSnapshot();
      const nextMessageState = updater(current.messageState);
      resolved = nextMessageState;
      if (nextMessageState === current.messageState) {
        return state;
      }
      return {
        byChatId: {
          ...state.byChatId,
          [chatId]: {
            ...current,
            messageState: nextMessageState,
          },
        },
      };
    });
    return resolved;
  },
  setTerminalOutputs(chatId, terminalOutputs) {
    let resolved = terminalOutputs;
    set((state) => {
      const current = state.byChatId[chatId] ?? createSnapshot();
      if (current.terminalOutputs === terminalOutputs) {
        resolved = current.terminalOutputs;
        return state;
      }
      resolved = terminalOutputs;
      return {
        byChatId: {
          ...state.byChatId,
          [chatId]: {
            ...current,
            terminalOutputs,
          },
        },
      };
    });
    return resolved;
  },
  appendTerminalOutput(chatId, terminalId, data) {
    let resolved: Record<string, string> = EMPTY_TERMINAL_OUTPUTS;
    set((state) => {
      const current = state.byChatId[chatId] ?? createSnapshot();
      const previousValue = current.terminalOutputs[terminalId] ?? "";
      const nextValue = trimTerminalOutput(`${previousValue}${data}`);
      if (nextValue === previousValue) {
        resolved = current.terminalOutputs;
        return state;
      }
      const nextOutputs = {
        ...current.terminalOutputs,
        [terminalId]: nextValue,
      };
      resolved = nextOutputs;
      return {
        byChatId: {
          ...state.byChatId,
          [chatId]: {
            ...current,
            terminalOutputs: nextOutputs,
          },
        },
      };
    });
    return resolved;
  },
  getTerminalOutputs(chatId) {
    return get().byChatId[chatId]?.terminalOutputs ?? EMPTY_TERMINAL_OUTPUTS;
  },
}));

export function useChatMessages(chatId: string | null | undefined): UIMessage[] {
  return useChatStreamStore((state) => {
    if (!chatId) {
      return EMPTY_MESSAGES;
    }
    return state.byChatId[chatId]?.messageState.orderedMessages ?? EMPTY_MESSAGES;
  });
}

export function useChatMessageCount(chatId: string | null | undefined): number {
  return useChatStreamStore((state) => {
    if (!chatId) {
      return 0;
    }
    return state.byChatId[chatId]?.messageState.order.length ?? 0;
  });
}

export function useChatTerminalOutputs(
  chatId: string | null | undefined
): Record<string, string> {
  return useChatStreamStore((state) => {
    if (!chatId) {
      return EMPTY_TERMINAL_OUTPUTS;
    }
    return state.byChatId[chatId]?.terminalOutputs ?? EMPTY_TERMINAL_OUTPUTS;
  });
}

export function getChatMessageStateSnapshot(
  chatId: string | null | undefined
): MessageState {
  if (!chatId) {
    return EMPTY_MESSAGE_STATE;
  }
  return useChatStreamStore.getState().getMessageState(chatId);
}

export function getChatTerminalOutputsSnapshot(
  chatId: string | null | undefined
): Record<string, string> {
  if (!chatId) {
    return EMPTY_TERMINAL_OUTPUTS;
  }
  return useChatStreamStore.getState().getTerminalOutputs(chatId);
}

