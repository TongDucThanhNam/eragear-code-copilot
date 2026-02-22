import type { UIMessage } from "@repo/shared";
import { create } from "zustand";
import {
  createEmptyMessageState,
  type MessageState,
} from "@/hooks/use-chat-message-state";

const TERMINAL_OUTPUT_MAX_CHARS = 256 * 1024;
const CHAT_STREAM_SNAPSHOT_MAX = 20;
let snapshotTouchSeq = 0;
const EMPTY_MESSAGE_STATE: MessageState = createEmptyMessageState();
const EMPTY_MESSAGES: UIMessage[] = [];
const EMPTY_TERMINAL_OUTPUTS: Record<string, string> = {};

interface ChatStreamSnapshot {
  messageState: MessageState;
  terminalOutputs: Record<string, string>;
  touchedSeq: number;
}

function nextSnapshotTouchSeq(): number {
  snapshotTouchSeq += 1;
  return snapshotTouchSeq;
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
    touchedSeq: nextSnapshotTouchSeq(),
  };
}

function upsertSnapshotWithLruLimit(
  byChatId: Record<string, ChatStreamSnapshot>,
  chatId: string,
  snapshot: ChatStreamSnapshot
): Record<string, ChatStreamSnapshot> {
  const nextByChatId = {
    ...byChatId,
    [chatId]: snapshot,
  };
  const entries = Object.entries(nextByChatId);
  if (entries.length <= CHAT_STREAM_SNAPSHOT_MAX) {
    return nextByChatId;
  }
  entries.sort((left, right) => {
    const touchedDiff = left[1].touchedSeq - right[1].touchedSeq;
    if (touchedDiff !== 0) {
      return touchedDiff;
    }
    return left[0].localeCompare(right[0]);
  });
  const overflow = entries.length - CHAT_STREAM_SNAPSHOT_MAX;
  for (let index = 0; index < overflow; index += 1) {
    const entry = entries[index];
    if (entry?.[0]) {
      delete nextByChatId[entry[0]];
    }
  }
  return nextByChatId;
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
      const nextSnapshot: ChatStreamSnapshot = {
        ...current,
        messageState: nextMessageState,
        touchedSeq: nextSnapshotTouchSeq(),
      };
      return {
        byChatId: upsertSnapshotWithLruLimit(
          state.byChatId,
          chatId,
          nextSnapshot
        ),
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
      const nextSnapshot: ChatStreamSnapshot = {
        ...current,
        terminalOutputs,
        touchedSeq: nextSnapshotTouchSeq(),
      };
      return {
        byChatId: upsertSnapshotWithLruLimit(
          state.byChatId,
          chatId,
          nextSnapshot
        ),
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
      const nextSnapshot: ChatStreamSnapshot = {
        ...current,
        terminalOutputs: nextOutputs,
        touchedSeq: nextSnapshotTouchSeq(),
      };
      return {
        byChatId: upsertSnapshotWithLruLimit(
          state.byChatId,
          chatId,
          nextSnapshot
        ),
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
