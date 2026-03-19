import type {
  ConnectionStatus,
  SessionStateData,
  UIMessage,
} from "@repo/shared";
import {
  applySessionState,
  findPendingPermission,
  parseUiMessageArrayStrict,
} from "@repo/shared";
import { type MutableRefObject, useCallback, useEffect } from "react";
import {
  finalizeMessagesAfterReady,
  shouldBackfillConnectedSessionState,
} from "@/hooks/use-chat-session-sync";
import {
  type StreamLifecycle,
  shouldApplyBootstrapHistory,
} from "@/hooks/use-chat-stream-machine";
import { trpc } from "@/lib/trpc";
import { useChatStore } from "@/store/chat-store";

const HISTORY_PAGE_LIMIT = 200;

interface UseChatHistorySyncParams {
  activeChatId: string | null;
  activeChatIsReadOnly: boolean;
  connStatus: ConnectionStatus;
  isConfigured: boolean;
  isResumingRef: MutableRefObject<boolean>;
  onErrorRef: MutableRefObject<((message: string) => void) | undefined>;
  streamLifecycle: StreamLifecycle;
  streamLifecycleRef: MutableRefObject<StreamLifecycle>;
}

export function useChatHistorySync({
  activeChatId,
  activeChatIsReadOnly,
  connStatus,
  isConfigured,
  isResumingRef,
  onErrorRef,
  streamLifecycle,
  streamLifecycleRef,
}: UseChatHistorySyncParams) {
  const utils = trpc.useUtils();

  const loadHistory = useCallback(
    async (force = false) => {
      if (!activeChatId || activeChatIsReadOnly) {
        return false;
      }
      const input = {
        chatId: activeChatId,
        direction: "backward" as const,
        limit: HISTORY_PAGE_LIMIT,
        includeCompacted: true,
      };
      if (force) {
        await utils.getSessionMessagesPage.invalidate(input);
      }
      const page = await utils.getSessionMessagesPage.fetch(input);
      const currentStore = useChatStore.getState();
      if (
        currentStore.activeChatId !== input.chatId ||
        currentStore.activeChatIsReadOnly
      ) {
        return false;
      }
      const parsedHistory = parseUiMessageArrayStrict(page.messages);
      if (!parsedHistory.ok) {
        useChatStore.getState().setError(parsedHistory.error);
        onErrorRef.current?.(parsedHistory.error);
        return false;
      }
      const store = useChatStore.getState();
      store.setMessages(parsedHistory.value);
      store.setPendingPermission(findPendingPermission(parsedHistory.value));
      return true;
    },
    [activeChatId, activeChatIsReadOnly, onErrorRef, utils]
  );

  const finalizeMessagesInStore = useCallback(() => {
    const store = useChatStore.getState();
    const orderedMessages = store.messageIds
      .map((messageId) => store.messagesById.get(messageId))
      .filter((message): message is UIMessage => Boolean(message));
    const finalizedMessages = finalizeMessagesAfterReady(orderedMessages);
    const changed = finalizedMessages.some(
      (message, index) => message !== orderedMessages[index]
    );
    if (!changed) {
      return orderedMessages;
    }
    store.setMessages(finalizedMessages);
    store.setPendingPermission(findPendingPermission(finalizedMessages));
    return finalizedMessages;
  }, []);

  const sessionStateQuery = trpc.getSessionState.useQuery(
    { chatId: activeChatId || "" },
    {
      enabled:
        isConfigured &&
        !!activeChatId &&
        !activeChatIsReadOnly &&
        streamLifecycle !== "idle" &&
        !isResumingRef.current,
      retry: false,
      staleTime: 0,
    }
  );

  const sessionMessagesQuery = trpc.getSessionMessagesPage.useQuery(
    {
      chatId: activeChatId || "",
      direction: "backward",
      limit: HISTORY_PAGE_LIMIT,
      includeCompacted: true,
    },
    {
      enabled:
        isConfigured &&
        !!activeChatId &&
        !activeChatIsReadOnly &&
        streamLifecycle !== "idle" &&
        !isResumingRef.current,
      retry: false,
      staleTime: 0,
    }
  );

  const applyStateToStore = useCallback((data: SessionStateData) => {
    const store = useChatStore.getState();
    applySessionState(data, {
      onStatusChange: store.setStatus,
      onModesChange: store.setModes,
      onModelsChange: store.setModels,
      onSupportsModelSwitchingChange: store.setSupportsModelSwitching,
      getCommands: () => useChatStore.getState().commands,
      onCommandsChange: (cmds) => {
        const normalized = cmds.map((cmd) => ({
          name: cmd.name,
          description: cmd.description,
          input: cmd.input,
        }));
        store.setCommands(normalized);
      },
      onPromptCapabilitiesChange: store.setPromptCapabilities,
      onLoadSessionSupportedChange: store.setLoadSessionSupported,
      onAgentInfoChange: store.setAgentInfo,
      onConnStatusChange: store.setConnStatus,
    });
  }, []);

  useEffect(() => {
    const data = sessionStateQuery.data;
    if (!data) {
      return;
    }

    const store = useChatStore.getState();
    const shouldRestoreWhileConnecting = connStatus === "connecting";
    const shouldBackfillWhileConnected =
      connStatus === "connected" &&
      shouldBackfillConnectedSessionState({
        sessionState: data,
        currentModes: store.modes,
        currentModels: store.models,
      });
    if (
      data.status !== "stopped" &&
      !(shouldRestoreWhileConnecting || shouldBackfillWhileConnected)
    ) {
      return;
    }
    const history = sessionMessagesQuery.data?.messages;
    if (
      Array.isArray(history) &&
      shouldApplyBootstrapHistory(streamLifecycleRef.current)
    ) {
      const parsedHistory = parseUiMessageArrayStrict(history);
      if (parsedHistory.ok) {
        store.setMessages(parsedHistory.value);
        store.setPendingPermission(findPendingPermission(parsedHistory.value));
      } else {
        store.setError(parsedHistory.error);
        onErrorRef.current?.(parsedHistory.error);
      }
    }

    if (data.status === "stopped") {
      if (data.loadSessionSupported !== undefined) {
        store.setLoadSessionSupported(data.loadSessionSupported);
      }
      if (data.agentInfo !== undefined) {
        store.setAgentInfo(data.agentInfo);
      }
    }
    applyStateToStore(data);
  }, [
    applyStateToStore,
    connStatus,
    onErrorRef,
    sessionMessagesQuery.data,
    sessionStateQuery.data,
    streamLifecycleRef,
  ]);

  return { loadHistory, finalizeMessagesInStore, utils };
}
