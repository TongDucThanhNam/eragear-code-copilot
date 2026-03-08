import type {
  BroadcastEvent,
  ChatStatus,
  ConnectionStatus,
} from "@repo/shared";
import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { StreamLifecycle } from "./use-chat-connection.machine";
import {
  nextLifecycleOnSubscriptionError,
  nextLifecycleOnSubscriptionStart,
} from "./use-chat-connection.machine";
import { parseBroadcastEvent } from "./use-chat-normalize";

const INVALID_EVENT_TOAST_COOLDOWN_MS = 5000;

function isChatNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    message?: unknown;
    data?: { code?: unknown } | null;
    shape?: {
      message?: unknown;
      data?: { code?: unknown } | null;
    } | null;
    cause?: unknown;
  };

  const messageValues = [candidate.message, candidate.shape?.message];
  for (const messageValue of messageValues) {
    if (
      typeof messageValue === "string" &&
      messageValue.toLowerCase().includes("chat not found")
    ) {
      return true;
    }
  }

  const codeValues = [candidate.data?.code, candidate.shape?.data?.code];
  for (const codeValue of codeValues) {
    if (
      typeof codeValue === "string" &&
      codeValue.toUpperCase() === "NOT_FOUND"
    ) {
      return true;
    }
  }

  if (candidate.cause && candidate.cause !== error) {
    return isChatNotFoundError(candidate.cause);
  }

  return false;
}

interface UseChatSubscriptionParams {
  chatId?: string | null;
  readOnly: boolean;
  subscriptionEpoch: number;
  activeChatIdRef: MutableRefObject<string | null>;
  handleSessionEvent: (event: BroadcastEvent) => void;
  setStreamLifecycle: Dispatch<SetStateAction<StreamLifecycle>>;
  setConnStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  setStatus: Dispatch<SetStateAction<ChatStatus>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

export function useChatSubscription(params: UseChatSubscriptionParams) {
  const {
    chatId,
    readOnly,
    subscriptionEpoch,
    activeChatIdRef,
    handleSessionEvent,
    setStreamLifecycle,
    setConnStatus,
    setStatus,
    setError,
  } = params;

  const invalidEventToastAtRef = useRef(0);
  const subscriptionEnabled = !!chatId && !readOnly;

  useEffect(() => {
    if (!subscriptionEnabled) {
      return;
    }
    setStreamLifecycle((prev) => nextLifecycleOnSubscriptionStart(prev));
  }, [setStreamLifecycle, subscriptionEnabled, subscriptionEpoch]);

  trpc.onSessionEvents.useSubscription(
    { chatId: chatId || "", subscriptionEpoch },
    {
      enabled: subscriptionEnabled,
      onData(rawEvent: unknown) {
        const subscribedChatId = chatId ?? null;
        if (subscribedChatId !== activeChatIdRef.current) {
          return;
        }
        const parsedEvent = parseBroadcastEvent(rawEvent);
        if (parsedEvent.status === "ignored_unknown_event") {
          console.warn("[Client] Ignored unknown session event", {
            error: parsedEvent.error,
          });
          return;
        }
        if (parsedEvent.status === "invalid_payload") {
          console.warn("[Client] Dropped invalid session event", {
            error: parsedEvent.error,
          });
          const now = Date.now();
          if (
            now - invalidEventToastAtRef.current >=
            INVALID_EVENT_TOAST_COOLDOWN_MS
          ) {
            invalidEventToastAtRef.current = now;
            toast.warning("Dropped malformed ACP event. Stream keeps running.");
          }
          return;
        }
        try {
          handleSessionEvent(parsedEvent.event);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to process chat session event";
          console.warn("[Client] Failed to process session event", {
            error: message,
          });
          setError(message);
        }
      },
      onError(subscriptionError) {
        const subscribedChatId = chatId ?? null;
        if (subscribedChatId !== activeChatIdRef.current) {
          return;
        }
        if (isChatNotFoundError(subscriptionError)) {
          setStreamLifecycle("idle");
          setConnStatus("idle");
          setStatus("inactive");
          setError(null);
          return;
        }
        console.error("[Client] Subscription error:", subscriptionError);
        setStreamLifecycle((prev) => nextLifecycleOnSubscriptionError(prev));
        setConnStatus("connecting");
        setError(subscriptionError.message);
        setStatus("connecting");
      },
    }
  );
}
