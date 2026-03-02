import type {
  ChatStatus,
  ConnectionStatus,
  PermissionRequest,
  SessionConfigOption,
  SessionModelState,
  SessionModeState,
  UIMessage,
} from "@repo/shared";
import { isChatBusyStatus } from "@repo/shared";
import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { StreamLifecycle } from "./use-chat-connection.machine";
import { chatDebug } from "./use-chat-debug";
import {
  deriveResumeSessionSyncPlan,
  isRuntimeAuthoritativeHistory,
} from "./use-chat-resume-sync";
import type { SendMessageOptions } from "./use-chat.types";

function readConfigOptionValueLabel(
  option: SessionConfigOption | undefined,
  value: string
): string {
  if (!option) {
    return value;
  }
  for (const entry of option.options ?? []) {
    const groupCandidate = entry as { options?: unknown };
    if (Array.isArray(groupCandidate.options)) {
      for (const nested of groupCandidate.options) {
        const nestedCandidate = nested as { value?: unknown; name?: unknown };
        if (
          nestedCandidate.value === value &&
          typeof nestedCandidate.name === "string" &&
          nestedCandidate.name.length > 0
        ) {
          return nestedCandidate.name;
        }
      }
      continue;
    }
    const optionCandidate = entry as { value?: unknown; name?: unknown };
    if (
      optionCandidate.value === value &&
      typeof optionCandidate.name === "string" &&
      optionCandidate.name.length > 0
    ) {
      return optionCandidate.name;
    }
  }
  return value;
}

function describeConfigOptionSelection(
  options: SessionConfigOption[],
  configId: string,
  value: string
): {
  category: string | null;
  optionName: string;
  valueLabel: string;
} {
  const option = options.find((candidate) => candidate.id === configId);
  const category =
    typeof option?.category === "string" && option.category.length > 0
      ? option.category.toLowerCase()
      : null;
  return {
    category,
    optionName: option?.name ?? configId,
    valueLabel: readConfigOptionValueLabel(option, value),
  };
}

interface UseChatActionsParams {
  chatId: string | null | undefined;
  readOnly: boolean;
  models: SessionModelState | null;
  configOptions: SessionConfigOption[];
  isActiveChat: (targetChatId: string) => boolean;
  statusRef: MutableRefObject<ChatStatus>;
  activeTurnIdRef: MutableRefObject<string | null>;
  isResumingRef: MutableRefObject<boolean>;
  setStatus: Dispatch<SetStateAction<ChatStatus>>;
  setConnStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setModes: Dispatch<SetStateAction<SessionModeState | null>>;
  setModels: Dispatch<SetStateAction<SessionModelState | null>>;
  setSupportsModelSwitching: Dispatch<SetStateAction<boolean>>;
  setConfigOptions: Dispatch<SetStateAction<SessionConfigOption[]>>;
  setPendingPermission: Dispatch<SetStateAction<PermissionRequest | null>>;
  setMessages: (messages: UIMessage[]) => void;
  setStreamLifecycle: Dispatch<SetStateAction<StreamLifecycle>>;
  onLocalModeMutated?: () => void;
  onLocalModelMutated?: () => void;
  onLocalConfigOptionMutated?: () => void;
  invalidateHistoryLoads: () => void;
  clearHistoryWindow: () => void;
  markHistoryAppliedFromRuntime: () => void;
  loadHistory: (force?: boolean) => Promise<void>;
  onResumeStateHydrated?: () => void;
}

export function useChatActions({
  chatId,
  readOnly,
  models,
  configOptions,
  isActiveChat,
  statusRef,
  activeTurnIdRef,
  isResumingRef,
  setStatus,
  setConnStatus,
  setError,
  setModes,
  setModels,
  setSupportsModelSwitching,
  setConfigOptions,
  setPendingPermission,
  setMessages,
  setStreamLifecycle,
  onLocalModeMutated,
  onLocalModelMutated,
  onLocalConfigOptionMutated,
  invalidateHistoryLoads,
  clearHistoryWindow,
  markHistoryAppliedFromRuntime,
  loadHistory,
  onResumeStateHydrated,
}: UseChatActionsParams) {
  const sendMessageMutation = trpc.sendMessage.useMutation();
  const cancelPromptMutation = trpc.cancelPrompt.useMutation();
  const setModeMutation = trpc.setMode.useMutation();
  const setModelMutation = trpc.setModel.useMutation();
  const setConfigOptionMutation = trpc.setConfigOption.useMutation();
  const stopSessionMutation = trpc.stopSession.useMutation();
  const resumeSessionMutation = trpc.resumeSession.useMutation();
  const permissionResponseMutation =
    trpc.respondToPermissionRequest.useMutation();

  const sendMessage = useCallback(
    async (text: string, messageOptions?: SendMessageOptions) => {
      if (!chatId) {
        return false;
      }
      if (
        isChatBusyStatus(statusRef.current) ||
        sendMessageMutation.isPending ||
        Boolean(activeTurnIdRef.current)
      ) {
        return false;
      }
      const activeChatId = chatId;
      const previousStatus = statusRef.current;
      // If lifecycle was parked in idle (e.g. session previously became
      // inactive), kick subscription back to bootstrapping before submit so
      // server has a live subscriber for streaming events.
      setStreamLifecycle((prev) => (prev === "idle" ? "bootstrapping" : prev));
      setConnStatus((prev) => (prev === "idle" ? "connecting" : prev));
      setStatus("submitted");
      try {
        const res = await sendMessageMutation.mutateAsync({
          chatId: activeChatId,
          text,
          images: messageOptions?.images,
          resources: messageOptions?.resources,
          resourceLinks: messageOptions?.resourceLinks,
        });
        if (!isActiveChat(activeChatId) || readOnly) {
          return false;
        }
        activeTurnIdRef.current = res.turnId ?? null;
        return res.status === "submitted";
      } catch (sendError) {
        console.error("Failed to send message", sendError);
        if (!isActiveChat(activeChatId) || readOnly) {
          return false;
        }
        setStatus(previousStatus);
        setError(
          sendError instanceof Error ? sendError.message : String(sendError)
        );
        return false;
      }
    },
    [
      activeTurnIdRef,
      chatId,
      isActiveChat,
      readOnly,
      sendMessageMutation,
      setConnStatus,
      setError,
      setStatus,
      setStreamLifecycle,
      statusRef,
    ]
  );

  const cancelPrompt = useCallback(async () => {
    if (!chatId) {
      return;
    }
    const activeChatId = chatId;
    const previousStatus = statusRef.current;
    setStatus("cancelling");
    try {
      await cancelPromptMutation.mutateAsync({ chatId: activeChatId });
    } catch (cancelError) {
      if (!isActiveChat(activeChatId)) {
        return;
      }
      console.error("Failed to cancel prompt", cancelError);
      setError(
        cancelError instanceof Error ? cancelError.message : String(cancelError)
      );
      setStatus(previousStatus);
    }
  }, [cancelPromptMutation, chatId, isActiveChat, setError, setStatus, statusRef]);

  const setMode = useCallback(
    async (modeId: string) => {
      if (!chatId) {
        return;
      }
      const activeChatId = chatId;
      try {
        await setModeMutation.mutateAsync({ chatId: activeChatId, modeId });
        if (!isActiveChat(activeChatId)) {
          return;
        }
        setModes((prev) => (prev ? { ...prev, currentModeId: modeId } : prev));
        onLocalModeMutated?.();
      } catch (modeError) {
        if (!isActiveChat(activeChatId)) {
          return;
        }
        console.error("Failed to set mode", modeError);
        setError(modeError instanceof Error ? modeError.message : String(modeError));
      }
    },
    [chatId, isActiveChat, onLocalModeMutated, setError, setModeMutation, setModes]
  );

  const setModel = useCallback(
    async (modelId: string) => {
      if (!chatId) {
        return;
      }
      const activeChatId = chatId;
      try {
        console.info("[Chat] setModel requested", { chatId: activeChatId, modelId });
        await setModelMutation.mutateAsync({ chatId: activeChatId, modelId });
        if (!isActiveChat(activeChatId)) {
          return;
        }
        setModels((prev) =>
          prev ? { ...prev, currentModelId: modelId } : prev
        );
        onLocalModelMutated?.();
        const modelName =
          models?.availableModels.find((model) => model.modelId === modelId)
            ?.name ?? modelId;
        toast.success(`Model switched to ${modelName}`);
        console.info("[Chat] setModel succeeded", {
          chatId: activeChatId,
          modelId,
        });
      } catch (modelError) {
        if (!isActiveChat(activeChatId)) {
          return;
        }
        const message = (modelError as Error).message || "Failed to set model";
        const normalized = message.toLowerCase();
        if (
          normalized.includes("model switching") ||
          normalized.includes("method not found")
        ) {
          setSupportsModelSwitching(false);
        }
        console.error("[Chat] setModel failed", {
          chatId: activeChatId,
          modelId,
          error: message,
        });
        setError(message);
      }
    },
    [
      chatId,
      isActiveChat,
      models,
      onLocalModelMutated,
      setError,
      setModelMutation,
      setModels,
      setSupportsModelSwitching,
    ]
  );

  const setConfigOption = useCallback(
    async (configId: string, value: string) => {
      if (!chatId) {
        return;
      }
      const activeChatId = chatId;
      try {
        chatDebug("config", "setConfigOption requested", {
          chatId: activeChatId,
          configId,
          value,
        });
        console.log("[Chat] setConfigOption requested", {
          chatId: activeChatId,
          configId,
          value,
        });
        const result = await setConfigOptionMutation.mutateAsync({
          chatId: activeChatId,
          configId,
          value,
        });
        if (!isActiveChat(activeChatId)) {
          chatDebug("config", "setConfigOption ignored: chat switched", {
            chatId: activeChatId,
            configId,
            value,
          });
          return;
        }
        const nextConfigOptions = Array.isArray(result?.configOptions)
          ? result.configOptions
          : configOptions;
        if (Array.isArray(result?.configOptions)) {
          setConfigOptions(result.configOptions);
        } else {
          setConfigOptions((prev) =>
            prev.map((option) =>
              option.id === configId
                ? { ...option, currentValue: value }
                : option
            )
          );
        }
        const selection = describeConfigOptionSelection(
          nextConfigOptions,
          configId,
          value
        );
        if (selection.category === "model") {
          toast.success(`Model switched to ${selection.valueLabel}`);
        } else if (selection.category === "mode") {
          toast.success(`Mode switched to ${selection.valueLabel}`);
        }
        chatDebug("config", "setConfigOption succeeded", {
          chatId: activeChatId,
          configId,
          value,
          optionName: selection.optionName,
          category: selection.category,
        });
        console.log("[Chat] setConfigOption succeeded", {
          chatId: activeChatId,
          configId,
          value,
          optionName: selection.optionName,
          category: selection.category,
        });
        onLocalConfigOptionMutated?.();
      } catch (configError) {
        if (!isActiveChat(activeChatId)) {
          return;
        }
        const message =
          configError instanceof Error
            ? configError.message
            : String(configError);
        console.error("[Chat] setConfigOption failed", {
          chatId: activeChatId,
          configId,
          value,
          error: message,
        });
        toast.error(message);
        setError(message);
      }
    },
    [
      chatId,
      configOptions,
      isActiveChat,
      onLocalConfigOptionMutated,
      setConfigOptionMutation,
      setConfigOptions,
      setError,
    ]
  );

  const respondToPermission = useCallback(
    async (requestId: string, decision: string) => {
      if (!chatId) {
        return;
      }
      const activeChatId = chatId;
      try {
        await permissionResponseMutation.mutateAsync({
          chatId: activeChatId,
          requestId,
          decision,
        });
        if (!isActiveChat(activeChatId)) {
          return;
        }
        setPendingPermission(null);
      } catch (permissionError) {
        if (!isActiveChat(activeChatId)) {
          return;
        }
        console.error("Failed to respond to permission", permissionError);
        const normalizedError =
          permissionError instanceof Error
            ? permissionError
            : new Error(String(permissionError));
        setError(normalizedError.message);
        throw normalizedError;
      }
    },
    [
      chatId,
      isActiveChat,
      permissionResponseMutation,
      setError,
      setPendingPermission,
    ]
  );

  const stopSession = useCallback(async () => {
    if (!chatId) {
      return;
    }
    const activeChatId = chatId;
    try {
      await stopSessionMutation.mutateAsync({ chatId: activeChatId });
      if (!isActiveChat(activeChatId)) {
        return;
      }
      setStreamLifecycle("idle");
      setConnStatus("idle");
      setStatus("inactive");
      activeTurnIdRef.current = null;
    } catch (stopError) {
      if (!isActiveChat(activeChatId)) {
        return;
      }
      console.error("Failed to stop session", stopError);
      setError(stopError instanceof Error ? stopError.message : String(stopError));
    }
  }, [
    activeTurnIdRef,
    chatId,
    isActiveChat,
    setConnStatus,
    setError,
    setStatus,
    setStreamLifecycle,
    stopSessionMutation,
  ]);

  const resumeSession = useCallback(async () => {
    if (!chatId) {
      return;
    }
    const activeChatId = chatId;
    try {
      chatDebug("resume", "resumeSession mutation start", {
        chatId: activeChatId,
      });
      isResumingRef.current = true;
      activeTurnIdRef.current = null;
      invalidateHistoryLoads();
      setStreamLifecycle("bootstrapping");
      setConnStatus("connecting");
      setStatus("connecting");
      const resumeResult = await resumeSessionMutation.mutateAsync({
        chatId: activeChatId,
      });
      const syncPlan = deriveResumeSessionSyncPlan(resumeResult);
      chatDebug("resume", "resumeSession mutation success", {
        chatId: activeChatId,
        hasResult: Boolean(resumeResult),
        sessionLoadMethod: syncPlan.sessionLoadMethod ?? null,
      });
      if (!isActiveChat(activeChatId)) {
        chatDebug("resume", "resumeSession ignored due to chat switch", {
          chatId: activeChatId,
        });
        isResumingRef.current = false;
        return;
      }
      const resolvedSessionLoadMethod = syncPlan.sessionLoadMethod;
      chatDebug("resume", "derived resume sync plan", {
        chatId: activeChatId,
        alreadyRunning: syncPlan.alreadyRunning,
        sessionLoadMethod: resolvedSessionLoadMethod ?? null,
        hasModes: syncPlan.modes !== undefined,
        hasModels: syncPlan.models !== undefined,
        hasConfigOptions: syncPlan.configOptions !== undefined,
        supportsModelSwitching: syncPlan.supportsModelSwitching,
      });
      if (syncPlan.modes !== undefined) {
        setModes(syncPlan.modes ?? null);
      }
      if (syncPlan.models !== undefined) {
        setModels(syncPlan.models ?? null);
      }
      if (syncPlan.configOptions !== undefined) {
        setConfigOptions(syncPlan.configOptions ?? []);
      }
      if (syncPlan.supportsModelSwitching !== undefined) {
        setSupportsModelSwitching(syncPlan.supportsModelSwitching);
      }
      setConnStatus("connected");
      setStatus("ready");
      onResumeStateHydrated?.();

      const runtimeAuthoritativeHistory = isRuntimeAuthoritativeHistory({
        alreadyRunning: syncPlan.alreadyRunning,
        sessionLoadMethod: resolvedSessionLoadMethod,
      });

      chatDebug("resume", "resetting message state before post-resume sync", {
        chatId: activeChatId,
        runtimeAuthoritativeHistory,
        sessionLoadMethod: resolvedSessionLoadMethod ?? null,
      });
      setMessages([]);
      clearHistoryWindow();

      let shouldReloadDbHistory = false;
      if (runtimeAuthoritativeHistory) {
        chatDebug("resume", "using runtime-authoritative history", {
          chatId: activeChatId,
          sessionLoadMethod: resolvedSessionLoadMethod ?? null,
        });
        markHistoryAppliedFromRuntime();
        // Always force a DB reload after resume to guarantee the UI receives
        // the canonical, persisted snapshot even if replay events were missed
        // during reconnect timing.
        shouldReloadDbHistory = true;
      } else {
        chatDebug("resume", "falling back to db history reload", {
          chatId: activeChatId,
          sessionLoadMethod: resolvedSessionLoadMethod ?? null,
        });
        shouldReloadDbHistory = true;
      }
      isResumingRef.current = false;
      if (shouldReloadDbHistory) {
        chatDebug("resume", "loadHistory(force=true) start after resume", {
          chatId: activeChatId,
        });
        await loadHistory(true);
        chatDebug("resume", "loadHistory(force=true) finished after resume", {
          chatId: activeChatId,
        });
      }
    } catch (resumeError) {
      if (!isActiveChat(activeChatId)) {
        chatDebug("resume", "resume error ignored due to chat switch", {
          chatId: activeChatId,
        });
        isResumingRef.current = false;
        return;
      }
      console.error("Failed to resume chat", resumeError);
      chatDebug("resume", "resumeSession mutation failed", {
        chatId: activeChatId,
        error:
          resumeError instanceof Error ? resumeError.message : String(resumeError),
      });
      setConnStatus("error");
      setStatus("error");
      setError(
        resumeError instanceof Error ? resumeError.message : String(resumeError)
      );
      isResumingRef.current = false;
    }
  }, [
    activeTurnIdRef,
    chatId,
    clearHistoryWindow,
    invalidateHistoryLoads,
    isResumingRef,
    isActiveChat,
    loadHistory,
    markHistoryAppliedFromRuntime,
    onResumeStateHydrated,
    resumeSessionMutation,
    setConnStatus,
    setConfigOptions,
    setError,
    setModes,
    setModels,
    setMessages,
    setStatus,
    setStreamLifecycle,
    setSupportsModelSwitching,
  ]);

  return {
    sendMessage,
    cancelPrompt,
    setMode,
    setModel,
    setConfigOption,
    respondToPermission,
    stopSession,
    resumeSession,
    isSending: sendMessageMutation.isPending,
    isCancelling: cancelPromptMutation.isPending,
    isResuming: resumeSessionMutation.isPending,
  };
}
