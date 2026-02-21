import type { UIMessage } from "@repo/shared";
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { MessageState } from "./use-chat-message-state";

const USER_MESSAGE_FALLBACK_TIMEOUT_MS = 1500;
const USER_MESSAGE_FALLBACK_RETRY_DELAY_MS = 300;
const USER_MESSAGE_FALLBACK_MAX_ATTEMPTS = 2;

type RecoverTrigger = "initial" | "retry" | "chat_finish";

interface UseChatFallbackParams {
  readOnly: boolean;
  activeChatIdRef: MutableRefObject<string | null>;
  messageStateRef: MutableRefObject<MessageState>;
  updateMessageState: (updater: (prev: MessageState) => MessageState) => void;
  upsertMessageIntoState: (
    prev: MessageState,
    message: UIMessage
  ) => MessageState;
  normalizeMessage: (message: unknown) => UIMessage;
  setError: (message: string | null) => void;
  onError?: (message: string) => void;
  fetchMessageById: (params: {
    chatId: string;
    messageId: string;
    signal: AbortSignal;
  }) => Promise<{ message?: unknown }>;
}

export function useChatFallback({
  readOnly,
  activeChatIdRef,
  messageStateRef,
  updateMessageState,
  upsertMessageIntoState,
  normalizeMessage,
  setError,
  onError,
  fetchMessageById,
}: UseChatFallbackParams) {
  const pendingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const pendingAbortRef = useRef(new AbortController());
  const pendingGenerationRef = useRef(0);

  const resetPendingController = useCallback(() => {
    pendingAbortRef.current.abort();
    pendingAbortRef.current = new AbortController();
    pendingGenerationRef.current += 1;
  }, []);

  const clearPending = useCallback((messageId: string) => {
    const timer = pendingTimersRef.current.get(messageId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    pendingTimersRef.current.delete(messageId);
  }, []);

  const clearAll = useCallback(() => {
    for (const [, timer] of pendingTimersRef.current) {
      clearTimeout(timer);
    }
    pendingTimersRef.current.clear();
    resetPendingController();
  }, [resetPendingController]);

  const recoverMissingSentMessage = useCallback(
    function recoverMissingSentMessageInternal(
      activeChatId: string,
      messageId: string,
      attempt = 1,
      trigger: RecoverTrigger = "initial"
    ) {
      const generation = pendingGenerationRef.current;
      const abortSignal = pendingAbortRef.current.signal;
      if (activeChatIdRef.current !== activeChatId || readOnly) {
        return;
      }
      if (messageStateRef.current.byId.has(messageId)) {
        return;
      }

      fetchMessageById({
        chatId: activeChatId,
        messageId,
        signal: abortSignal,
      })
        .then((result) => {
          if (
            abortSignal.aborted ||
            generation !== pendingGenerationRef.current ||
            activeChatIdRef.current !== activeChatId ||
            readOnly
          ) {
            return;
          }

          const message = result.message;
          if (!message) {
            if (attempt < USER_MESSAGE_FALLBACK_MAX_ATTEMPTS) {
              console.warn("[Chat] Missing sent message, retrying fallback", {
                chatId: activeChatId,
                messageId,
                attempt,
                trigger,
              });
              clearPending(messageId);
              const retryTimer = setTimeout(() => {
                if (
                  abortSignal.aborted ||
                  generation !== pendingGenerationRef.current
                ) {
                  return;
                }
                pendingTimersRef.current.delete(messageId);
                recoverMissingSentMessageInternal(
                  activeChatId,
                  messageId,
                  attempt + 1,
                  "retry"
                );
              }, USER_MESSAGE_FALLBACK_RETRY_DELAY_MS);
              pendingTimersRef.current.set(messageId, retryTimer);
            }
            return;
          }

          if (messageStateRef.current.byId.has(messageId)) {
            return;
          }

          let normalizedMessage: UIMessage;
          try {
            normalizedMessage = normalizeMessage(message);
          } catch (parseError) {
            const parseErrorMessage =
              parseError instanceof Error
                ? parseError.message
                : "Invalid fallback session message payload";
            console.warn("[Chat] Dropping invalid recovered message", {
              chatId: activeChatId,
              messageId,
              error: parseErrorMessage,
            });
            setError(parseErrorMessage);
            onError?.(parseErrorMessage);
            return;
          }

          updateMessageState((prev) => {
            if (prev.byId.has(normalizedMessage.id)) {
              return prev;
            }
            return upsertMessageIntoState(prev, normalizedMessage);
          });
        })
        .catch((fallbackError) => {
          const errorMessage =
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError);
          if (attempt < USER_MESSAGE_FALLBACK_MAX_ATTEMPTS) {
            console.warn("[Chat] Fallback fetch failed, retrying", {
              chatId: activeChatId,
              messageId,
              attempt,
              trigger,
              error: errorMessage,
            });
            clearPending(messageId);
            const retryTimer = setTimeout(() => {
              if (
                abortSignal.aborted ||
                generation !== pendingGenerationRef.current
              ) {
                return;
              }
              pendingTimersRef.current.delete(messageId);
              recoverMissingSentMessageInternal(
                activeChatId,
                messageId,
                attempt + 1,
                "retry"
              );
            }, USER_MESSAGE_FALLBACK_RETRY_DELAY_MS);
            pendingTimersRef.current.set(messageId, retryTimer);
            return;
          }
          console.warn("[Chat] Failed to recover missing sent message", {
            chatId: activeChatId,
            messageId,
            attempt,
            trigger,
            error: errorMessage,
          });
        });
    },
    [
      activeChatIdRef,
      clearPending,
      fetchMessageById,
      messageStateRef,
      normalizeMessage,
      onError,
      readOnly,
      setError,
      updateMessageState,
      upsertMessageIntoState,
    ]
  );

  const flushAll = useCallback(() => {
    const activeChatId = activeChatIdRef.current;
    if (!activeChatId || readOnly) {
      clearAll();
      return;
    }
    for (const [messageId, timer] of pendingTimersRef.current) {
      clearTimeout(timer);
      pendingTimersRef.current.delete(messageId);
      recoverMissingSentMessage(activeChatId, messageId, 1, "chat_finish");
    }
  }, [activeChatIdRef, clearAll, readOnly, recoverMissingSentMessage]);

  const schedule = useCallback(
    (activeChatId: string, messageId: string) => {
      clearPending(messageId);
      const timer = setTimeout(() => {
        pendingTimersRef.current.delete(messageId);
        recoverMissingSentMessage(activeChatId, messageId, 1, "initial");
      }, USER_MESSAGE_FALLBACK_TIMEOUT_MS);
      pendingTimersRef.current.set(messageId, timer);
    },
    [clearPending, recoverMissingSentMessage]
  );

  useEffect(() => {
    return () => {
      for (const [, timer] of pendingTimersRef.current) {
        clearTimeout(timer);
      }
      pendingTimersRef.current.clear();
      resetPendingController();
    };
  }, [resetPendingController]);

  return {
    clearPending,
    clearAll,
    flushAll,
    schedule,
    reset: clearAll,
  };
}
