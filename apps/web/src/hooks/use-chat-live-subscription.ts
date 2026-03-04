import type { ChatStatus, ConnectionStatus } from "@repo/shared";
import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import { useCallback, useEffect, useRef } from "react";
import type { StreamLifecycle } from "./use-chat-connection.machine";
import { chatDebug } from "./use-chat-debug";

const LIVE_SUBSCRIPTION_WAIT_TIMEOUT_MS = 8000;

interface UseLiveSubscriptionGateParams {
  readOnly: boolean;
  connStatus: ConnectionStatus;
  streamLifecycle: StreamLifecycle;
  activeChatIdRef: MutableRefObject<string | null>;
  connectedChatIdRef: MutableRefObject<string | null>;
  statusRef: MutableRefObject<ChatStatus>;
  connStatusRef: MutableRefObject<ConnectionStatus>;
  loadHistory: (force?: boolean) => Promise<void>;
  setStreamLifecycle: Dispatch<SetStateAction<StreamLifecycle>>;
  setConnStatus: Dispatch<SetStateAction<ConnectionStatus>>;
}

type LiveSubscriptionWaiter = (isLive: boolean) => void;

export function useLiveSubscriptionGate(params: UseLiveSubscriptionGateParams) {
  const {
    readOnly,
    connStatus,
    streamLifecycle,
    activeChatIdRef,
    connectedChatIdRef,
    statusRef,
    connStatusRef,
    loadHistory,
    setStreamLifecycle,
    setConnStatus,
  } = params;

  const previousStreamLifecycleRef = useRef<StreamLifecycle>(streamLifecycle);
  const streamLifecycleRef = useRef<StreamLifecycle>(streamLifecycle);
  const liveSubscriptionWaiterSeqRef = useRef(0);
  const liveSubscriptionWaitersRef = useRef<
    Map<number, LiveSubscriptionWaiter>
  >(new Map());

  useEffect(() => {
    const previous = previousStreamLifecycleRef.current;
    if (previous === "recovering" && streamLifecycle === "live") {
      void loadHistory(true);
    }
    streamLifecycleRef.current = streamLifecycle;
    const activeChatId = activeChatIdRef.current;
    const isLiveForActiveChat =
      streamLifecycle === "live" &&
      Boolean(activeChatId) &&
      connectedChatIdRef.current === activeChatId;
    const hasConnectionFailure =
      streamLifecycle === "recovering" || connStatus === "error";
    if (streamLifecycle === "idle" || isLiveForActiveChat || hasConnectionFailure) {
      const waiters = [...liveSubscriptionWaitersRef.current.values()];
      liveSubscriptionWaitersRef.current.clear();
      for (const waiter of waiters) {
        waiter(isLiveForActiveChat);
      }
    }
    previousStreamLifecycleRef.current = streamLifecycle;
  }, [
    activeChatIdRef,
    connectedChatIdRef,
    connStatus,
    loadHistory,
    streamLifecycle,
  ]);

  useEffect(() => {
    return () => {
      const waiters = [...liveSubscriptionWaitersRef.current.values()];
      liveSubscriptionWaitersRef.current.clear();
      for (const waiter of waiters) {
        waiter(false);
      }
    };
  }, []);

  const ensureLiveSubscription = useCallback(async () => {
    const activeChatId = activeChatIdRef.current;
    if (!activeChatId || readOnly) {
      return false;
    }
    // Reject immediately when the session is known-inactive — no runtime
    // exists on the server side so sending would always fail.
    if (statusRef.current === "inactive") {
      chatDebug(
        "stream",
        "ensureLiveSubscription rejected: session is inactive",
        { chatId: activeChatId, status: statusRef.current }
      );
      return false;
    }
    if (
      streamLifecycleRef.current === "recovering" ||
      connStatusRef.current === "error"
    ) {
      chatDebug(
        "stream",
        "ensureLiveSubscription rejected: subscription is recovering from error",
        {
          chatId: activeChatId,
          lifecycle: streamLifecycleRef.current,
          connStatus: connStatusRef.current,
        }
      );
      return false;
    }
    const isLiveForActiveChat =
      streamLifecycleRef.current === "live" &&
      connectedChatIdRef.current === activeChatId;
    if (isLiveForActiveChat) {
      return true;
    }
    chatDebug("stream", "ensureLiveSubscription waiting for live stream", {
      chatId: activeChatId,
      lifecycle: streamLifecycleRef.current,
      connStatus: connStatusRef.current,
      connectedChatId: connectedChatIdRef.current,
    });
    setStreamLifecycle((prev) => (prev === "idle" ? "bootstrapping" : prev));
    setConnStatus((prev) => (prev === "idle" ? "connecting" : prev));

    const isLive = await new Promise<boolean>((resolve) => {
      const waiterId = ++liveSubscriptionWaiterSeqRef.current;
      const cleanup = () => {
        liveSubscriptionWaitersRef.current.delete(waiterId);
      };
      const timeout = setTimeout(() => {
        cleanup();
        const isLiveForCurrentChat =
          streamLifecycleRef.current === "live" &&
          connectedChatIdRef.current === activeChatId;
        resolve(isLiveForCurrentChat);
      }, LIVE_SUBSCRIPTION_WAIT_TIMEOUT_MS);

      liveSubscriptionWaitersRef.current.set(waiterId, (nextIsLive) => {
        clearTimeout(timeout);
        cleanup();
        resolve(nextIsLive);
      });
    });
    if (!isLive) {
      chatDebug("stream", "ensureLiveSubscription timed out", {
        chatId: activeChatId,
        lifecycle: streamLifecycleRef.current,
        connStatus: connStatusRef.current,
        connectedChatId: connectedChatIdRef.current,
      });
    }
    return isLive;
  }, [
    activeChatIdRef,
    connectedChatIdRef,
    connStatusRef,
    readOnly,
    setConnStatus,
    setStreamLifecycle,
    statusRef,
  ]);

  return {
    ensureLiveSubscription,
  };
}
