import type { PermissionRequest, UIMessage } from "@repo/shared";
import { findPendingPermission } from "@repo/shared";
import { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { MessageState } from "./use-chat-message-state";
import {
  mergeMessagesIntoState,
  prependMessagesIntoState,
  replaceMessagesState,
} from "./use-chat-message-state";
import { chatDebug } from "./use-chat-debug";

const HISTORY_INITIAL_WINDOW_LIMIT = 100;
const HISTORY_LOAD_MORE_LIMIT = 100;

export function normalizeOlderHistoryBatchOrder(
  messages: UIMessage[],
  state: MessageState
): UIMessage[] {
  if (messages.length < 2) {
    return messages;
  }
  const knownIndexes: number[] = [];
  for (const message of messages) {
    const index = state.indexById.get(message.id);
    if (index !== undefined) {
      knownIndexes.push(index);
    }
  }
  if (knownIndexes.length < 2) {
    return messages;
  }
  const firstKnown = knownIndexes[0];
  const lastKnown = knownIndexes[knownIndexes.length - 1];
  if (
    firstKnown === undefined ||
    lastKnown === undefined ||
    firstKnown <= lastKnown
  ) {
    return messages;
  }
  return [...messages].reverse();
}

interface HistoryPage {
  messages: unknown;
  nextCursor?: number;
  hasMore: boolean;
}

interface FetchHistoryPageInput {
  chatId: string;
  cursor?: number;
  direction: "backward";
  limit: number;
  includeCompacted: true;
}

interface UseChatHistoryParams {
  chatId: string | null | undefined;
  connStatus: "idle" | "connecting" | "connected" | "error";
  readOnly: boolean;
  isResumingRef: MutableRefObject<boolean>;
  isActiveChat: (targetChatId: string) => boolean;
  messageStateRef: MutableRefObject<MessageState>;
  setPendingPermission: (permission: PermissionRequest | null) => void;
  setError: (message: string | null) => void;
  onError?: (message: string) => void;
  updateMessageState: (updater: (prev: MessageState) => MessageState) => void;
  normalizeMessages: (messages: unknown) => UIMessage[];
  fetchHistoryPage: (input: FetchHistoryPageInput) => Promise<HistoryPage>;
}

export function runSharedInFlightLoad(
  inFlightRef: MutableRefObject<Promise<void> | null>,
  load: () => Promise<void>
): Promise<void> {
  if (inFlightRef.current) {
    return inFlightRef.current;
  }
  let inFlight: Promise<void> | null = null;
  inFlight = load().finally(() => {
    if (inFlightRef.current === inFlight) {
      inFlightRef.current = null;
    }
  });
  inFlightRef.current = inFlight;
  return inFlight;
}

export function useChatHistory({
  chatId,
  connStatus,
  readOnly,
  isResumingRef,
  isActiveChat,
  messageStateRef,
  setPendingPermission,
  setError,
  onError,
  updateMessageState,
  normalizeMessages,
  fetchHistoryPage,
}: UseChatHistoryParams) {
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [isLoadingOlderHistory, setIsLoadingOlderHistory] = useState(false);
  const historyAppliedRef = useRef(false);
  const historyLoadingRef = useRef(false);
  const olderHistoryLoadingRef = useRef(false);
  const historyInFlightRef = useRef<Promise<void> | null>(null);
  const historyLoadVersionRef = useRef(0);
  const historyNextCursorRef = useRef<number | undefined>(undefined);

  const invalidateHistoryLoads = useCallback(() => {
    historyLoadVersionRef.current += 1;
    historyLoadingRef.current = false;
    olderHistoryLoadingRef.current = false;
    historyInFlightRef.current = null;
  }, []);

  const markHistoryNotApplied = useCallback(() => {
    historyAppliedRef.current = false;
  }, []);

  /**
   * Mark history as already sourced from runtime replay so initial DB load is
   * skipped unless explicitly forced by caller.
   */
  const markHistoryAppliedFromRuntime = useCallback(() => {
    historyAppliedRef.current = true;
    historyLoadingRef.current = false;
    olderHistoryLoadingRef.current = false;
    historyInFlightRef.current = null;
    historyNextCursorRef.current = undefined;
    setHasMoreHistory(false);
    setIsLoadingOlderHistory(false);
  }, []);

  const clearHistoryWindow = useCallback(() => {
    historyAppliedRef.current = false;
    historyNextCursorRef.current = undefined;
    setHasMoreHistory(false);
  }, []);

  const resetHistoryState = useCallback(() => {
    historyAppliedRef.current = false;
    historyLoadingRef.current = false;
    olderHistoryLoadingRef.current = false;
    historyInFlightRef.current = null;
    historyNextCursorRef.current = undefined;
    invalidateHistoryLoads();
    setHasMoreHistory(false);
    setIsLoadingOlderHistory(false);
  }, [invalidateHistoryLoads]);

  const loadHistory = useCallback(
    async (force = false) => {
      if (historyInFlightRef.current) {
        chatDebug("history", "loadHistory skipped: in-flight request exists", {
          chatId: chatId ?? null,
          force,
        });
        return historyInFlightRef.current;
      }

      const activeChatId = chatId ?? null;
      if (!activeChatId || readOnly || isResumingRef.current) {
        chatDebug("history", "loadHistory skipped: inactive/readOnly/resuming", {
          chatId: activeChatId,
          readOnly,
          isResuming: isResumingRef.current,
          force,
        });
        return;
      }
      if (!isActiveChat(activeChatId)) {
        chatDebug("history", "loadHistory skipped: chat no longer active", {
          chatId: activeChatId,
          force,
        });
        return;
      }
      if (historyLoadingRef.current) {
        chatDebug("history", "loadHistory skipped: history loading lock set", {
          chatId: activeChatId,
          force,
        });
        return;
      }
      if (!force && historyAppliedRef.current) {
        chatDebug("history", "loadHistory skipped: history already applied", {
          chatId: activeChatId,
          force,
        });
        return;
      }
      if (!force && connStatus !== "connecting" && connStatus !== "connected") {
        chatDebug("history", "loadHistory skipped: connection status not ready", {
          chatId: activeChatId,
          connStatus,
          force,
        });
        return;
      }

      chatDebug("history", "loadHistory started (source=db:getSessionMessagesPage)", {
        chatId: activeChatId,
        force,
      });
      const loadVersion = historyLoadVersionRef.current + 1;
      historyLoadVersionRef.current = loadVersion;
      historyLoadingRef.current = true;
      return runSharedInFlightLoad(historyInFlightRef, async () => {
        try {
          const page = await fetchHistoryPage({
            chatId: activeChatId,
            direction: "backward",
            limit: HISTORY_INITIAL_WINDOW_LIMIT,
            includeCompacted: true,
          });
          chatDebug("history", "loadHistory page fetched from db", {
            chatId: activeChatId,
            force,
            messageCount: Array.isArray(page.messages) ? page.messages.length : -1,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor ?? null,
          });
          if (
            historyLoadVersionRef.current !== loadVersion ||
            !isActiveChat(activeChatId) ||
            readOnly
          ) {
            chatDebug(
              "history",
              "loadHistory result ignored: version/chat/readOnly changed",
              {
                chatId: activeChatId,
                force,
                readOnly,
              }
            );
            return;
          }

          const normalizedMessages = normalizeMessages(page.messages);
          chatDebug("history", "loadHistory messages normalized", {
            chatId: activeChatId,
            force,
            normalizedCount: normalizedMessages.length,
            firstMessageId: normalizedMessages[0]?.id ?? null,
            lastMessageId:
              normalizedMessages[normalizedMessages.length - 1]?.id ?? null,
          });
          if (normalizedMessages.length > 0) {
            updateMessageState((prev) => {
              if (force || prev.order.length === 0) {
                return replaceMessagesState(normalizedMessages);
              }
              return mergeMessagesIntoState(prev, normalizedMessages);
            });
            setPendingPermission(
              findPendingPermission(messageStateRef.current.byId.values())
            );
          }

          historyNextCursorRef.current = page.nextCursor;
          setHasMoreHistory(
            Boolean(page.hasMore && page.nextCursor !== undefined)
          );
          historyAppliedRef.current = true;
          chatDebug("history", "loadHistory applied to client state", {
            chatId: activeChatId,
            force,
            hasMore: Boolean(page.hasMore && page.nextCursor !== undefined),
            nextCursor: page.nextCursor ?? null,
          });
        } catch (historyError) {
          if (historyLoadVersionRef.current !== loadVersion) {
            return;
          }
          const message =
            historyError instanceof Error
              ? historyError.message
              : "Failed to load session history";
          console.error("Failed to load chat history", historyError);
          chatDebug("history", "loadHistory failed", {
            chatId: activeChatId,
            force,
            error: message,
          });
          setError(message);
          onError?.(message);
        } finally {
          if (historyLoadVersionRef.current === loadVersion) {
            historyLoadingRef.current = false;
          }
        }
      });
    },
    [
      chatId,
      connStatus,
      fetchHistoryPage,
      isActiveChat,
      isResumingRef,
      messageStateRef,
      normalizeMessages,
      onError,
      readOnly,
      setError,
      setPendingPermission,
      updateMessageState,
    ]
  );

  const loadOlderHistory = useCallback(async () => {
    const activeChatId = chatId ?? null;
    if (!activeChatId || readOnly || isResumingRef.current) {
      return;
    }
    if (!isActiveChat(activeChatId)) {
      return;
    }
    if (
      historyLoadingRef.current ||
      olderHistoryLoadingRef.current ||
      !hasMoreHistory
    ) {
      return;
    }

    const cursor = historyNextCursorRef.current;
    if (cursor === undefined) {
      setHasMoreHistory(false);
      return;
    }

    olderHistoryLoadingRef.current = true;
    setIsLoadingOlderHistory(true);
    try {
      const page = await fetchHistoryPage({
        chatId: activeChatId,
        cursor,
        direction: "backward",
        limit: HISTORY_LOAD_MORE_LIMIT,
        includeCompacted: true,
      });
      if (!isActiveChat(activeChatId) || readOnly) {
        return;
      }

      const normalizedMessages = normalizeMessages(page.messages);
      if (normalizedMessages.length > 0) {
        const prependBatch = normalizeOlderHistoryBatchOrder(
          normalizedMessages,
          messageStateRef.current
        );
        updateMessageState((prev) =>
          prependMessagesIntoState(prev, prependBatch)
        );
        setPendingPermission(
          findPendingPermission(messageStateRef.current.byId.values())
        );
      }

      historyNextCursorRef.current = page.nextCursor;
      setHasMoreHistory(Boolean(page.hasMore && page.nextCursor !== undefined));
    } catch (historyError) {
      if (!isActiveChat(activeChatId)) {
        return;
      }
      const message =
        historyError instanceof Error
          ? historyError.message
          : "Failed to load older session history";
      console.error("Failed to load older chat history", historyError);
      setError(message);
      onError?.(message);
    } finally {
      olderHistoryLoadingRef.current = false;
      if (isActiveChat(activeChatId)) {
        setIsLoadingOlderHistory(false);
      }
    }
  }, [
    chatId,
    fetchHistoryPage,
    hasMoreHistory,
    isActiveChat,
    isResumingRef,
    messageStateRef,
    normalizeMessages,
    onError,
    readOnly,
    setError,
    setPendingPermission,
    updateMessageState,
  ]);

  const refreshHistory = useCallback(async () => {
    await loadHistory(true);
  }, [loadHistory]);

  return {
    clearHistoryWindow,
    hasMoreHistory,
    historyAppliedRef,
    invalidateHistoryLoads,
    isLoadingOlderHistory,
    loadHistory,
    loadOlderHistory,
    markHistoryAppliedFromRuntime,
    markHistoryNotApplied,
    refreshHistory,
    resetHistoryState,
  };
}
