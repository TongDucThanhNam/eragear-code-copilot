import type { PermissionRequest, UIMessage } from "@repo/shared";
import { findPendingPermission } from "@repo/shared";
import { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { MessageState } from "./use-chat-message-state";
import {
  getOrderedMessages,
  mergeMessagesIntoState,
  prependMessagesIntoState,
  replaceMessagesState,
} from "./use-chat-message-state";

const HISTORY_INITIAL_WINDOW_LIMIT = 100;
const HISTORY_LOAD_MORE_LIMIT = 100;

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
        return historyInFlightRef.current;
      }

      const activeChatId = chatId ?? null;
      if (!activeChatId || readOnly || isResumingRef.current) {
        return;
      }
      if (!isActiveChat(activeChatId)) {
        return;
      }
      if (historyLoadingRef.current) {
        return;
      }
      if (!force && historyAppliedRef.current) {
        return;
      }
      if (!force && connStatus !== "connecting" && connStatus !== "connected") {
        return;
      }

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
          if (
            historyLoadVersionRef.current !== loadVersion ||
            !isActiveChat(activeChatId) ||
            readOnly
          ) {
            return;
          }

          const normalizedMessages = normalizeMessages(page.messages);
          if (normalizedMessages.length > 0) {
            const shouldRebaseOrder = !historyAppliedRef.current;
            updateMessageState((prev) => {
              if (prev.order.length === 0) {
                return replaceMessagesState(normalizedMessages);
              }
              if (!shouldRebaseOrder) {
                return mergeMessagesIntoState(prev, normalizedMessages);
              }
              const existingOrderedMessages = getOrderedMessages(prev);
              const historyState = replaceMessagesState(normalizedMessages);
              return mergeMessagesIntoState(historyState, existingOrderedMessages);
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
        } catch (historyError) {
          if (historyLoadVersionRef.current !== loadVersion) {
            return;
          }
          const message =
            historyError instanceof Error
              ? historyError.message
              : "Failed to load session history";
          console.error("Failed to load chat history", historyError);
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
        updateMessageState((prev) =>
          prependMessagesIntoState(prev, normalizedMessages)
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
    markHistoryNotApplied,
    refreshHistory,
    resetHistoryState,
  };
}
