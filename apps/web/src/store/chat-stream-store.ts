import {
  findPendingPermission,
  type PermissionRequest,
  type UIMessage,
} from "@repo/shared";
import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  diagLog,
  isClientDiagnosticsEnabled,
} from "@/hooks/use-chat-diagnostics";
import {
  createEmptyMessageState,
  type MessageState,
} from "@/hooks/use-chat-message-state";

export const TERMINAL_OUTPUT_MAX_CHARS = 256 * 1024;
export const CHAT_TERMINAL_OUTPUT_MAX_CHARS = 1024 * 1024;
const TERMINAL_OUTPUT_CHUNK_MAX_CHARS = 8 * 1024;
const CHAT_STREAM_SNAPSHOT_MAX = 20;
let snapshotTouchSeq = 0;
const EMPTY_MESSAGE_STATE: MessageState = createEmptyMessageState();
const EMPTY_MESSAGES: UIMessage[] = [];
const EMPTY_MESSAGE_IDS: readonly string[] = [];
const EMPTY_MESSAGE: UIMessage | null = null;
const EMPTY_PENDING_PERMISSION: PermissionRequest | null = null;
const EMPTY_TERMINAL_OUTPUT = "";
const EMPTY_TERMINAL_CHUNKS: readonly string[] = [];
const EMPTY_TERMINAL_SELECTION: readonly (string | TerminalOutputBuffer | null)[] =
  [];
const EMPTY_TERMINAL_BUFFERS: Record<string, TerminalOutputBuffer> = {};
const EMPTY_TERMINAL_SNAPSHOTS: readonly TerminalOutputSnapshot[] = [];

interface TerminalOutputBuffer {
  chunks: readonly string[];
  totalChars: number;
  startOffset: number;
  touchedSeq: number;
}

export interface TerminalOutputSnapshot {
  terminalId: string;
  chunks: readonly string[];
  totalChars: number;
  startOffset: number;
  touchedSeq: number;
}

interface ChatStreamSnapshot {
  messageState: MessageState;
  terminalBuffers: Record<string, TerminalOutputBuffer>;
  terminalTotalChars: number;
  touchedSeq: number;
}

interface TerminalOutputReadable {
  chunks: readonly string[];
  totalChars: number;
}

function nextSnapshotTouchSeq(): number {
  snapshotTouchSeq += 1;
  return snapshotTouchSeq;
}

function copyDetachedString(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return ` ${value}`.slice(1);
}

interface ChatStreamStore {
  byChatId: Record<string, ChatStreamSnapshot>;
  clearChat(chatId: string): void;
  getMessageState(chatId: string): MessageState;
  updateMessageState(
    chatId: string,
    updater: (prev: MessageState) => MessageState
  ): MessageState;
  appendTerminalOutput(chatId: string, terminalId: string, data: string): void;
}

function createSnapshot(): ChatStreamSnapshot {
  return {
    messageState: createEmptyMessageState(),
    terminalBuffers: {},
    terminalTotalChars: 0,
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

function trimTerminalBufferChunks(
  chunks: string[],
  totalChars: number,
  startOffset: number
): { chunks: string[]; totalChars: number; startOffset: number } {
  if (totalChars <= TERMINAL_OUTPUT_MAX_CHARS) {
    return { chunks, totalChars, startOffset };
  }

  let charsToTrim = totalChars - TERMINAL_OUTPUT_MAX_CHARS;
  const nextChunks = [...chunks];
  while (charsToTrim > 0 && nextChunks.length > 0) {
    const firstChunk = nextChunks[0] ?? "";
    if (charsToTrim >= firstChunk.length) {
      charsToTrim -= firstChunk.length;
      totalChars -= firstChunk.length;
      startOffset += firstChunk.length;
      nextChunks.shift();
      continue;
    }
    nextChunks[0] = copyDetachedString(firstChunk.slice(charsToTrim));
    totalChars -= charsToTrim;
    startOffset += charsToTrim;
    charsToTrim = 0;
  }

  return { chunks: nextChunks, totalChars, startOffset };
}

function appendTerminalBuffer(
  previousBuffer: TerminalOutputBuffer | undefined,
  data: string
): TerminalOutputBuffer | undefined {
  if (data.length === 0) {
    return previousBuffer;
  }

  const nextChunks = previousBuffer?.chunks ? [...previousBuffer.chunks] : [];
  let remaining = data;
  const lastIndex = nextChunks.length - 1;
  if (lastIndex >= 0) {
    const lastChunk = nextChunks[lastIndex] ?? "";
    if (lastChunk.length < TERMINAL_OUTPUT_CHUNK_MAX_CHARS) {
      const availableChars = TERMINAL_OUTPUT_CHUNK_MAX_CHARS - lastChunk.length;
      const mergedChunk = remaining.slice(0, availableChars);
      if (mergedChunk.length > 0) {
        nextChunks[lastIndex] = `${lastChunk}${mergedChunk}`;
        remaining = remaining.slice(mergedChunk.length);
      }
    }
  }

  while (remaining.length > 0) {
    nextChunks.push(remaining.slice(0, TERMINAL_OUTPUT_CHUNK_MAX_CHARS));
    remaining = remaining.slice(TERMINAL_OUTPUT_CHUNK_MAX_CHARS);
  }

  const trimmed = trimTerminalBufferChunks(
    nextChunks,
    (previousBuffer?.totalChars ?? 0) + data.length,
    previousBuffer?.startOffset ?? 0
  );
  return {
    chunks: trimmed.chunks,
    totalChars: trimmed.totalChars,
    startOffset: trimmed.startOffset,
    touchedSeq: nextSnapshotTouchSeq(),
  };
}

function pruneTerminalBuffersForChat(
  terminalBuffers: Record<string, TerminalOutputBuffer>,
  terminalTotalChars: number
): {
  terminalBuffers: Record<string, TerminalOutputBuffer>;
  terminalTotalChars: number;
} {
  if (terminalTotalChars <= CHAT_TERMINAL_OUTPUT_MAX_CHARS) {
    return {
      terminalBuffers,
      terminalTotalChars,
    };
  }

  const sortedBuffers = Object.entries(terminalBuffers).sort((left, right) => {
    const touchedDiff = left[1].touchedSeq - right[1].touchedSeq;
    if (touchedDiff !== 0) {
      return touchedDiff;
    }
    return left[0].localeCompare(right[0]);
  });
  const nextTerminalBuffers = { ...terminalBuffers };
  let nextTerminalTotalChars = terminalTotalChars;
  for (const [terminalId, buffer] of sortedBuffers) {
    if (nextTerminalTotalChars <= CHAT_TERMINAL_OUTPUT_MAX_CHARS) {
      break;
    }
    delete nextTerminalBuffers[terminalId];
    nextTerminalTotalChars -= buffer.totalChars;
  }
  return {
    terminalBuffers: nextTerminalBuffers,
    terminalTotalChars: Math.max(nextTerminalTotalChars, 0),
  };
}

function toTerminalOutputSnapshot(
  terminalId: string,
  buffer: TerminalOutputBuffer | null | undefined
): TerminalOutputSnapshot {
  if (!buffer) {
    return {
      terminalId,
      chunks: EMPTY_TERMINAL_CHUNKS,
      totalChars: 0,
      startOffset: 0,
      touchedSeq: 0,
    };
  }
  return {
    terminalId,
    chunks: buffer.chunks,
    totalChars: buffer.totalChars,
    startOffset: buffer.startOffset,
    touchedSeq: buffer.touchedSeq,
  };
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
    // [DIAG] Measure updateMessageState duration and message/part count
    let diagStart = 0;
    let diagPrevCount = 0;
    let diagPrevParts = 0;
    if (isClientDiagnosticsEnabled()) {
      diagStart = performance.now();
      const prevSnapshot = get().byChatId[chatId];
      if (prevSnapshot) {
        diagPrevCount = prevSnapshot.messageState.order.length;
        for (const msg of prevSnapshot.messageState.orderedMessages) {
          diagPrevParts += msg.parts.length;
        }
      }
    }
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
    // [DIAG] Log updateMessageState duration
    if (isClientDiagnosticsEnabled() && diagStart > 0) {
      const diagDuration = performance.now() - diagStart;
      let diagNewParts = 0;
      for (const msg of resolved.orderedMessages) {
        diagNewParts += msg.parts.length;
      }
      diagLog("store-updateMessageState", {
        chatId,
        durationMs: diagDuration.toFixed(2),
        messageCount: resolved.order.length,
        partCount: diagNewParts,
        prevMessageCount: diagPrevCount,
        prevPartCount: diagPrevParts,
        slow: diagDuration > 16,
      });
    }
    return resolved;
  },
  appendTerminalOutput(chatId, terminalId, data) {
    if (data.length === 0) {
      return;
    }
    set((state) => {
      const current = state.byChatId[chatId] ?? createSnapshot();
      const previousBuffer = current.terminalBuffers[terminalId];
      const nextBuffer = appendTerminalBuffer(previousBuffer, data);
      if (!nextBuffer || nextBuffer === previousBuffer) {
        return state;
      }
      const nextTerminalBuffers = {
        ...current.terminalBuffers,
        [terminalId]: nextBuffer,
      };
      const nextTerminalTotalChars =
        current.terminalTotalChars -
        (previousBuffer?.totalChars ?? 0) +
        nextBuffer.totalChars;
      const prunedTerminals = pruneTerminalBuffersForChat(
        nextTerminalBuffers,
        nextTerminalTotalChars
      );
      const nextSnapshot: ChatStreamSnapshot = {
        ...current,
        terminalBuffers: prunedTerminals.terminalBuffers,
        terminalTotalChars: prunedTerminals.terminalTotalChars,
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

export function useChatMessageIds(
  chatId: string | null | undefined
): readonly string[] {
  return useChatStreamStore((state) => {
    if (!chatId) {
      return EMPTY_MESSAGE_IDS;
    }
    return state.byChatId[chatId]?.messageState.order ?? EMPTY_MESSAGE_IDS;
  });
}

export function useChatMessageById(
  chatId: string | null | undefined,
  messageId: string | null | undefined
): UIMessage | null {
  return useChatStreamStore((state) => {
    if (!chatId || !messageId) {
      return EMPTY_MESSAGE;
    }
    return state.byChatId[chatId]?.messageState.byId.get(messageId) ?? EMPTY_MESSAGE;
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

export function useChatPendingPermission(
  chatId: string | null | undefined
): PermissionRequest | null {
  const messageState = useChatStreamStore((state) => {
    if (!chatId) {
      return EMPTY_MESSAGE_STATE;
    }
    return state.byChatId[chatId]?.messageState ?? EMPTY_MESSAGE_STATE;
  });

  return useMemo(() => {
    if (messageState === EMPTY_MESSAGE_STATE) {
      return EMPTY_PENDING_PERMISSION;
    }
    return findPendingPermission(messageState.byId.values());
  }, [messageState]);
}

export function readTerminalOutputBuffer(
  buffer: TerminalOutputReadable | undefined
): string {
  if (!buffer || buffer.totalChars === 0 || buffer.chunks.length === 0) {
    return EMPTY_TERMINAL_OUTPUT;
  }
  if (buffer.chunks.length === 1) {
    return buffer.chunks[0] ?? EMPTY_TERMINAL_OUTPUT;
  }
  return buffer.chunks.join("");
}

export function readCombinedTerminalOutput(
  terminalBuffers: Record<string, TerminalOutputReadable>,
  terminalIds: readonly string[]
): string {
  if (terminalIds.length === 0) {
    return EMPTY_TERMINAL_OUTPUT;
  }
  if (terminalIds.length === 1) {
    return readTerminalOutputBuffer(terminalBuffers[terminalIds[0] ?? ""]);
  }

  const chunks: string[] = [];
  for (const terminalId of terminalIds) {
    const terminalChunks = terminalBuffers[terminalId]?.chunks;
    if (!terminalChunks || terminalChunks.length === 0) {
      continue;
    }
    chunks.push(...terminalChunks);
  }
  if (chunks.length === 0) {
    return EMPTY_TERMINAL_OUTPUT;
  }
  return chunks.join("");
}

export function useChatTerminalSnapshots(
  chatId: string | null | undefined,
  terminalIds: readonly string[]
): readonly TerminalOutputSnapshot[] {
  const selection = useChatStreamStore(
    useShallow((state) => {
      if (!chatId || terminalIds.length === 0) {
        return EMPTY_TERMINAL_SELECTION;
      }
      const terminalBuffers =
        state.byChatId[chatId]?.terminalBuffers ?? EMPTY_TERMINAL_BUFFERS;
      const nextSelection: Array<string | TerminalOutputBuffer | null> = [];
      for (const terminalId of terminalIds) {
        nextSelection.push(terminalId, terminalBuffers[terminalId] ?? null);
      }
      return nextSelection;
    })
  );

  return useMemo(() => {
    if (selection.length === 0) {
      return EMPTY_TERMINAL_SNAPSHOTS;
    }
    const snapshots: TerminalOutputSnapshot[] = [];
    for (let index = 0; index < selection.length; index += 2) {
      snapshots.push(
        toTerminalOutputSnapshot(
          selection[index] as string,
          (selection[index + 1] as TerminalOutputBuffer | null | undefined) ??
            null
        )
      );
    }
    return snapshots;
  }, [selection]);
}

export function getChatMessageStateSnapshot(
  chatId: string | null | undefined
): MessageState {
  if (!chatId) {
    return EMPTY_MESSAGE_STATE;
  }
  return useChatStreamStore.getState().getMessageState(chatId);
}
