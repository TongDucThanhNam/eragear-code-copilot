import type { UIMessage } from "@repo/shared";
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { MessageState } from "./use-chat-message-state";

const DELTA_RECOVERY_ATTEMPT_COOLDOWN_MS = 1200;
const DELTA_RECOVERY_HISTORY_RELOAD_COOLDOWN_MS = 5000;

export type DeltaDropReason = "message_not_found" | "part_not_found";

interface UseChatDeltaRecoveryParams {
  readOnly: boolean;
  activeChatIdRef: MutableRefObject<string | null>;
  messageStateRef: MutableRefObject<MessageState>;
  updateMessageState: (updater: (prev: MessageState) => MessageState) => void;
  upsertMessageIntoState: (
    prev: MessageState,
    message: UIMessage
  ) => MessageState;
  normalizeMessage: (message: unknown) => UIMessage;
  fetchMessageById: (params: {
    chatId: string;
    messageId: string;
    signal: AbortSignal;
  }) => Promise<{ message?: unknown }>;
  reloadHistory: () => Promise<void>;
}

export function useChatDeltaRecovery({
  readOnly,
  activeChatIdRef,
  messageStateRef,
  updateMessageState,
  upsertMessageIntoState,
  normalizeMessage,
  fetchMessageById,
  reloadHistory,
}: UseChatDeltaRecoveryParams) {
  const attemptsRef = useRef<Map<string, number>>(new Map());
  const inFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  const lastHistoryReloadAtRef = useRef(0);
  const abortRef = useRef(new AbortController());
  const generationRef = useRef(0);

  const reset = useCallback(() => {
    attemptsRef.current.clear();
    inFlightRef.current.clear();
    lastHistoryReloadAtRef.current = 0;
    abortRef.current.abort();
    abortRef.current = new AbortController();
    generationRef.current += 1;
  }, []);

  const recoverMissingDelta = useCallback(
    (messageId: string, reason: DeltaDropReason) => {
      const activeChatId = activeChatIdRef.current;
      if (!activeChatId || readOnly) {
        return;
      }
      if (
        reason === "message_not_found" &&
        messageStateRef.current.byId.has(messageId)
      ) {
        return;
      }

      const now = Date.now();
      const lastAttemptAt = attemptsRef.current.get(messageId) ?? 0;
      if (now - lastAttemptAt < DELTA_RECOVERY_ATTEMPT_COOLDOWN_MS) {
        return;
      }
      if (inFlightRef.current.has(messageId)) {
        return;
      }
      attemptsRef.current.set(messageId, now);

      const generation = generationRef.current;
      const abortSignal = abortRef.current.signal;
      const reconcilePromise = fetchMessageById({
        chatId: activeChatId,
        messageId,
        signal: abortSignal,
      })
        .then(async (result) => {
          if (
            abortSignal.aborted ||
            generation !== generationRef.current ||
            activeChatIdRef.current !== activeChatId ||
            readOnly
          ) {
            return;
          }

          if (!result.message) {
            if (
              now - lastHistoryReloadAtRef.current >=
              DELTA_RECOVERY_HISTORY_RELOAD_COOLDOWN_MS
            ) {
              lastHistoryReloadAtRef.current = now;
              await reloadHistory();
            }
            return;
          }

          let normalized: UIMessage;
          try {
            normalized = normalizeMessage(result.message);
          } catch (parseError) {
            console.warn("[Chat] Dropped invalid message during delta recovery", {
              chatId: activeChatId,
              messageId,
              reason,
              error:
                parseError instanceof Error
                  ? parseError.message
                  : String(parseError),
            });
            return;
          }
          updateMessageState((prev) => {
            const existing = prev.byId.get(normalized.id);
            if (existing === normalized) {
              return prev;
            }
            return upsertMessageIntoState(prev, normalized);
          });
        })
        .catch((error) => {
          if (
            abortSignal.aborted ||
            generation !== generationRef.current ||
            activeChatIdRef.current !== activeChatId
          ) {
            return;
          }
          console.warn("[Chat] Delta recovery fetch failed", {
            chatId: activeChatId,
            messageId,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          const inFlight = inFlightRef.current.get(messageId);
          if (inFlight === reconcilePromise) {
            inFlightRef.current.delete(messageId);
          }
        });

      inFlightRef.current.set(messageId, reconcilePromise);
    },
    [
      activeChatIdRef,
      fetchMessageById,
      messageStateRef,
      normalizeMessage,
      readOnly,
      reloadHistory,
      updateMessageState,
      upsertMessageIntoState,
    ]
  );

  useEffect(() => reset, [reset]);

  return {
    recoverMissingDelta,
    resetDeltaRecoveryState: reset,
  };
}
