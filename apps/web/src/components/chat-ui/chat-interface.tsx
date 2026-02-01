import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { ChatHeader } from "@/components/chat-ui/chat-header";
import { ChatInput } from "@/components/chat-ui/chat-input";
import {
  ChatMessages,
} from "@/components/chat-ui/chat-messages";
import type { ToolUIPart, UIMessage } from "@repo/shared";
import { QuickSwitchDialog } from "@/components/chat-ui/quick-switch-dialog";
import { trpc } from "@/lib/trpc";
import { useChatStatusStore } from "@/store/chat-status-store";
import { useDiffStore } from "@/store/diff-store";
import { useFileStore } from "@/store/file-store";
import { useProjectStore } from "@/store/project-store";

const convertFileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

interface ChatInterfaceProps {
  initialChatId?: string | null;
  onChatIdChange?: (chatId: string | null) => void;
}

export function ChatInterface({
  initialChatId,
  onChatIdChange,
}: ChatInterfaceProps) {
  const utils = trpc.useUtils();
  const { data: agentsData } = trpc.agents.list.useQuery();
  const { data: sessionsData } = trpc.getSessions.useQuery();

  const activeAgentId = agentsData?.activeAgentId;
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId),
    [activeProjectId, projects]
  );
  const projectLookup = useMemo(() => {
    return projects.reduce<Record<string, string>>((acc, project) => {
      acc[project.id] = project.name;
      return acc;
    }, {});
  }, [projects]);

  const [status, setStatus] = useState<
    "submitted" | "streaming" | "ready" | "error"
  >("ready");
  const [chatId, setChatId] = useState<string | null>(initialChatId || null);
  const [connStatus, setConnStatus] = useState<
    "idle" | "connecting" | "connected" | "error"
  >(initialChatId ? "connecting" : "idle");
  const [currentModeId, setCurrentModeId] = useState<string | null>(null);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [isQuickSwitchOpen, setIsQuickSwitchOpen] = useState(false);

  const [availableModes, setAvailableModes] = useState<
    { id: string; name: string; description?: string }[]
  >([]);
  const [availableModels, setAvailableModels] = useState<
    { modelId: string; name: string; description?: string }[]
  >([]);
  const [availableCommands, setAvailableCommands] = useState<
    { name: string; description: string; input?: { hint: string } }[]
  >([]);
  const [promptCapabilities, setPromptCapabilities] = useState<{
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  }>({});
  const [loadSessionSupported, setLoadSessionSupported] = useState<
    boolean | undefined
  >(undefined);
  const [sessionAgentInfo, setSessionAgentInfo] = useState<{
    name: string;
    title?: string;
    version: string;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatIdRef = useRef<string | null>(initialChatId || null);
  const isReplayingHistoryRef = useRef(false);
  const isResumingRef = useRef(false); // Track when resuming to skip chatHistory restore

  const [terminalOutputs, setTerminalOutputs] = useState<
    Record<string, string>
  >({});

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const batchUpdateQueueRef = useRef<
    Array<(prev: UIMessage[]) => UIMessage[]>
  >([]);
  const batchUpdateTimerRef = useRef<NodeJS.Timeout | null>(null);

  const quickSwitchSessions = useMemo(() => {
    return (sessionsData || [])
      .filter((session) => !session.archived)
      .sort((a, b) => {
        const pinnedA = a.pinned ?? false;
        const pinnedB = b.pinned ?? false;
        if (pinnedA !== pinnedB) {
          return pinnedA ? -1 : 1;
        }
        return (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0);
      })
      .map((session) => ({
        id: session.id,
        name: session.name
          ? session.name
          : session.agentName
            ? session.agentName
            : `Session ${session.id.slice(0, 8)}`,
        projectName: session.projectId
          ? projectLookup[session.projectId]
          : null,
      }));
  }, [projectLookup, sessionsData]);

  const selectSession = useCallback(
    (id: string) => {
      setIsQuickSwitchOpen(false);
      onChatIdChange?.(id);
    },
    [onChatIdChange]
  );

  useEffect(() => {
    return () => {
      // Clean up timers on unmount
      if (batchUpdateTimerRef.current) {
        clearTimeout(batchUpdateTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const isEditableElement = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      const tag = target.tagName;
      return (
        target.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT"
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableElement(event.target)) {
        return;
      }

      const isCtrlOrMeta = event.ctrlKey || event.metaKey;
      if (isCtrlOrMeta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsQuickSwitchOpen(true);
        return;
      }

      if (event.ctrlKey && event.key === "Tab" && !event.metaKey) {
        event.preventDefault();
        if (quickSwitchSessions.length === 0) {
          return;
        }
        const currentIndex = quickSwitchSessions.findIndex(
          (session) => session.id === chatIdRef.current
        );
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex =
          currentIndex === -1
            ? 0
            : (currentIndex + direction + quickSwitchSessions.length) %
              quickSwitchSessions.length;
        const nextSession = quickSwitchSessions[nextIndex];
        if (nextSession) {
          onChatIdChange?.(nextSession.id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onChatIdChange, quickSwitchSessions]);

  // Batch updates to reduce re-renders during streaming
  const flushBatchQueue = useCallback(() => {
    if (batchUpdateQueueRef.current.length === 0) return;

    const updates = batchUpdateQueueRef.current;
    batchUpdateQueueRef.current = [];

    setMessages((prev) => {
      let result = prev;
      for (const updater of updates) {
        result = updater(result);
      }
      return result;
    });
  }, []);

  const updateMessagesState = useCallback(
    (updater: (old: UIMessage[]) => UIMessage[]) => {
      // Queue the update instead of immediate setMessages
      batchUpdateQueueRef.current.push(updater);

      // Clear existing timer
      if (batchUpdateTimerRef.current) {
        clearTimeout(batchUpdateTimerRef.current);
      }

      // Batch updates with a 16ms debounce (roughly one frame)
      batchUpdateTimerRef.current = setTimeout(() => {
        flushBatchQueue();
      }, 16);
    },
    [flushBatchQueue]
  );

  useEffect(() => {
    if (initialChatId && initialChatId !== chatId) {
      console.log(
        "[ChatInterface] Reconnecting to chat from prop:",
        initialChatId
      );
      // Invalidate the old session state to force refetch
      utils.getSessionState.invalidate({ chatId: chatId || "" });
      utils.getSessionMessages.invalidate({ chatId: chatId || "" });

      // Clear old messages before loading new ones
      setMessages([]);
      setLoadSessionSupported(undefined);
      setSessionAgentInfo(null);

      setChatId(initialChatId);
      chatIdRef.current = initialChatId;
      setConnStatus("connecting");
      isReplayingHistoryRef.current = true;
      console.log(
        "[ChatInterface] State updated - chatId:",
        initialChatId,
        "connStatus: connecting"
      );
    } else if (!initialChatId && chatId) {
      // If prop cleared but we have local state, reset everything
      console.log("[ChatInterface] Clearing chat");
      utils.getSessionState.invalidate({ chatId });
      utils.getSessionMessages.invalidate({ chatId });

      setChatId(null);
      chatIdRef.current = null;
      setConnStatus("idle");
      setMessages([]);
      setStatus("ready");
      setLoadSessionSupported(undefined);
      setSessionAgentInfo(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChatId]);

  const createSessionMutation = trpc.createSession.useMutation();
  const sendMessageMutation = trpc.sendMessage.useMutation();
  const stopSessionMutation = trpc.stopSession.useMutation();
  const setModeMutation = trpc.setMode.useMutation();
  const setModelMutation = trpc.setModel.useMutation();
  const resumeSessionMutation = trpc.resumeSession.useMutation();
  const cancelPromptMutation = trpc.cancelPrompt.useMutation();
  const permissionResponseMutation =
    trpc.respondToPermissionRequest.useMutation();
  const setActiveAgentMutation = trpc.agents.setActive.useMutation();

  /* const {
    data: sessionState,
    isLoading: isLoadingState,
    error: stateError,
  } = trpc.getSessionState.useQuery(
     ...
  ); */

  const {
    data: sessionState,
    isLoading: isLoadingState,
    error: stateError,
  } = trpc.getSessionState.useQuery(
    { chatId: chatId || "" },
    {
      enabled: !!chatId && connStatus === "connecting",
      retry: false,
      staleTime: 0,
    }
  );

  const {
    data: chatHistory,
    isLoading: isLoadingHistory,
    error: historyError,
  } = trpc.getSessionMessages.useQuery(
    { chatId: chatId || "" },
    {
      enabled: !!chatId && connStatus === "connecting",
      retry: false,
      staleTime: 0,
    }
  );

  // Debug log
  useEffect(() => {
    if (connStatus === "connecting") {
      console.log("[ChatInterface] Query status:", {
        chatId,
        connStatus,
        isLoadingState,
        isLoadingHistory,
        hasSessionState: !!sessionState,
        hasChatHistory: !!chatHistory,
        stateError: stateError?.message,
        historyError: historyError?.message,
      });
    }
  }, [
    chatId,
    connStatus,
    isLoadingState,
    isLoadingHistory,
    sessionState,
    chatHistory,
    stateError,
    historyError,
  ]);

  // Dispatch auth error event when UNAUTHORIZED is detected
  useEffect(() => {
    const errorMessage = stateError?.message || historyError?.message || "";
    if (
      (connStatus === "connecting" || connStatus === "error") &&
      (errorMessage.includes("UNAUTHORIZED") ||
        errorMessage.toLowerCase().includes("unauthorized") ||
        errorMessage.toLowerCase().includes("authentication"))
    ) {
      window.dispatchEvent(
        new CustomEvent("auth-error", {
          detail: "Authentication failed. Please check your API key.",
        })
      );
      setConnStatus("error");
    }
  }, [stateError, historyError, connStatus]);

  const restoreSessionState = useCallback(
    (state: NonNullable<typeof sessionState>) => {
      if (state.modes) {
        setAvailableModes(
          state.modes.availableModes.map((m) => ({
            ...m,
            description: m.description || undefined,
          }))
        );
        setCurrentModeId(state.modes.currentModeId || null);
      }
      if (state.models) {
        setAvailableModels(
          state.models.availableModels.map((m) => ({
            modelId: m.modelId,
            name: m.name,
            description: m.description || undefined,
          }))
        );
        setCurrentModelId(state.models.currentModelId || null);
      }
      if (state.commands) {
        setAvailableCommands(
          state.commands.map((c) => ({
            name: c.name,
            description: c.description,
            input: c.input ?? undefined,
          }))
        );
      }
      if (state.promptCapabilities) {
        setPromptCapabilities(state.promptCapabilities);
      }
      setLoadSessionSupported(state.loadSessionSupported ?? false);
      if (state.agentInfo) {
        setSessionAgentInfo(state.agentInfo);
      }
    },
    []
  );

  useEffect(() => {
    console.log("[Client] sessionState effect:", {
      sessionState,
      connStatus,
      hasSessionState: !!sessionState,
    });
    if (sessionState && connStatus === "connecting") {
      console.log("[Client] Session state restored:", sessionState);

      // Only restore messages from history if NOT resuming
      // When resuming, server will replay messages via events
      if (!isResumingRef.current && chatHistory && Array.isArray(chatHistory)) {
        console.log(
          "[Client] Restoring chat history:",
          chatHistory.length,
          "messages"
        );
        setMessages(chatHistory as UIMessage[]);
      }

      if (sessionState.status === "stopped") {
        console.log("[Client] Session is stopped, but history restored");
        setLoadSessionSupported(sessionState.loadSessionSupported ?? false);
        setConnStatus("idle");
        setStatus("ready");
        isResumingRef.current = false;
        return;
      }

      restoreSessionState(sessionState);
      setConnStatus("connected");
      setStatus("ready");
      isResumingRef.current = false;
    }
  }, [sessionState, chatHistory, connStatus, restoreSessionState]);

  const upsertUiMessage = useCallback(
    (next: UIMessage) => {
      updateMessagesState((prev) => {
        const index = prev.findIndex((message) => message.id === next.id);
        if (index === -1) {
          return [...prev, next];
        }
        const updated = [...prev];
        updated[index] = next;
        return updated;
      });
    },
    [updateMessagesState]
  );

  const isMessageStreaming = useCallback((message: UIMessage) => {
    return message.parts.some((part) => {
      if (part.type === "text" || part.type === "reasoning") {
        return part.state === "streaming";
      }
      if (part.type.startsWith("tool-")) {
        const toolPart = part as ToolUIPart;
        return (
          toolPart.state === "input-streaming" ||
          toolPart.state === "input-available" ||
          toolPart.state === "approval-requested" ||
          toolPart.state === "approval-responded"
        );
      }
      return false;
    });
  }, []);

  const handleApproveTool = useCallback(
    (requestId: string, decision = "allow") => {
      if (!chatId) {
        return;
      }
      permissionResponseMutation.mutate({
        chatId,
        requestId,
        decision,
      });
    },
    [chatId, permissionResponseMutation]
  );

  const handleRejectTool = useCallback(
    (requestId: string, decision = "reject") => {
      if (!chatId) {
        return;
      }
      permissionResponseMutation.mutate({
        chatId,
        requestId,
        decision,
      });
    },
    [chatId, permissionResponseMutation]
  );

  type BroadcastEvent =
    | { type: "connected" }
    | { type: "ui_message"; message: UIMessage }
    | {
        type: "available_commands_update";
        availableCommands: Array<{
          name: string;
          description: string;
          input?: { hint: string } | null;
        }>;
      }
    | { type: "current_mode_update"; modeId: string }
    | { type: "error"; error: string }
    | { type: "heartbeat"; ts: number }
    | { type: "terminal_output"; terminalId: string; data: string };

  const processSessionEvent = useCallback(
    (event: BroadcastEvent) => {
      switch (event.type) {
        case "connected":
          console.log("[Client] Connection confirmed by server");
          setConnStatus("connected");
          setStatus("ready");
          isReplayingHistoryRef.current = true;
          return;

        case "ui_message": {
          upsertUiMessage(event.message);
          if (event.message.role === "assistant") {
            const streaming = isMessageStreaming(event.message);
            setStatus(streaming ? "streaming" : "ready");
            if (!streaming) {
              isReplayingHistoryRef.current = false;
            }
          }
          return;
        }

        case "available_commands_update":
          setAvailableCommands(
            event.availableCommands.map((c) => ({
              name: c.name,
              description: c.description,
              input: c.input ?? undefined,
            }))
          );
          return;

        case "current_mode_update":
          setCurrentModeId(event.modeId);
          return;

        case "terminal_output":
          if (event.terminalId && event.data) {
            setTerminalOutputs((prev) => ({
              ...prev,
              [event.terminalId]: (prev[event.terminalId] || "") + event.data,
            }));
          }
          return;

        case "error":
          console.error("tRPC Error Event:", event.error);
          setConnStatus("error");
          setMessages((prev) => [
            ...prev,
            {
              id: nanoid(),
              role: "assistant",
              parts: [{ type: "text", text: `❌ Error: ${event.error}` }],
            },
          ]);
          return;

        case "heartbeat":
          console.log("[Client] Heartbeat", event.ts);
          return;

        default:
          return;
      }
    },
    [
      isMessageStreaming,
      setAvailableCommands,
      setConnStatus,
      setCurrentModeId,
      setMessages,
      setStatus,
      setTerminalOutputs,
      upsertUiMessage,
    ]
  );

  const subscriptionEnabled = !!chatId && connStatus === "connected";
  console.log("[Client] Subscription check:", {
    chatId,
    connStatus,
    subscriptionEnabled,
  });

  trpc.onSessionEvents.useSubscription(
    { chatId: chatId || "" },
    {
      enabled: subscriptionEnabled,
      onData(event: unknown) {
        console.log("[Client] tRPC Event:", event);
        processSessionEvent(event as BroadcastEvent);
      },
      onError(err) {
        console.error("[Client] Subscription error:", err);
        setConnStatus("error");
      },
    }
  );

  const initChat = useCallback(
    async (agentId?: string) => {
      const targetId = agentId || activeAgentId;
      const agent = agentsData?.agents.find((a) => a.id === targetId);
      const activeProject = useProjectStore.getState().getActiveProject();

      if (!agent) {
        console.warn("No active agent selected");
        setConnStatus("idle");
        return;
      }
      if (!activeProject) {
        toast.error("Please select a project before starting a chat.");
        setConnStatus("idle");
        return;
      }

      setConnStatus("connecting");
      try {
        const data = await createSessionMutation.mutateAsync({
          projectId: activeProject.id,
          command: agent?.command,
          args: agent?.args,
          env: agent?.env,
        });

        setChatId(data.chatId);
        chatIdRef.current = data.chatId;

        if (onChatIdChange) {
          onChatIdChange(data.chatId);
        }

        if (data.modes) {
          setAvailableModes(
            data.modes.availableModes.map((m) => ({
              ...m,
              description: m.description || undefined,
            }))
          );
          setCurrentModeId(data.modes.currentModeId || null);
        }
        if (data.models) {
          setAvailableModels(
            data.models.availableModels.map((m) => ({
              modelId: m.modelId,
              name: m.name,
              description: m.description || undefined,
            }))
          );
          setCurrentModelId(data.models.currentModelId || null);
        }
        if (data.promptCapabilities) {
          setPromptCapabilities(data.promptCapabilities);
        }
        setLoadSessionSupported(data.loadSessionSupported ?? false);
        if (data.agentInfo) {
          setSessionAgentInfo(data.agentInfo);
        }
        setConnStatus("connected");
      } catch (e) {
        console.error("Failed to init chat", e);
        setConnStatus("error");
      }
    },
    [createSessionMutation, onChatIdChange]
  );

  const handleNewChat = (agentId: string) => {
    setMessages([]);
    setChatId(null);
    chatIdRef.current = null;
    setTerminalOutputs({});
    setLoadSessionSupported(undefined);
    setSessionAgentInfo(null);
    useDiffStore.getState().clearDiffs();

    if (onChatIdChange) {
      onChatIdChange(null);
    }

    setActiveAgentMutation.mutate({ id: agentId });
    initChat(agentId);
  };

  const handleStopChat = async () => {
    const targetChatId = chatIdRef.current;
    if (!targetChatId) {
      return;
    }
    try {
      await stopSessionMutation.mutateAsync({ chatId: targetChatId });
      setConnStatus("idle");
      setChatId(null);
      chatIdRef.current = null;

      if (onChatIdChange) {
        onChatIdChange(null);
      }

      setAvailableModes([]);
      setCurrentModeId(null);
      setAvailableModels([]);
      setCurrentModelId(null);
    } catch (e) {
      console.error("Failed to stop chat", e);
    }
  };

  const handleCancel = async () => {
    if (!chatId) {
      return;
    }
    try {
      await cancelPromptMutation.mutateAsync({ chatId });
    } catch (e) {
      console.error("Failed to cancel prompt", e);
    }
  };

  const handleResume = async () => {
    if (!chatId) {
      return;
    }
    try {
      isReplayingHistoryRef.current = true;
      isResumingRef.current = true; // Mark as resuming to skip chatHistory restore
      setConnStatus("connecting");

      // Clear messages before resuming to avoid duplicates from replay events
      setMessages([]);

      await resumeSessionMutation.mutateAsync({ chatId });
      const nextState = await utils.getSessionState.fetch({ chatId });
      if (nextState.status === "stopped") {
        setConnStatus("idle");
        return;
      }
      restoreSessionState(nextState);
      setConnStatus("connected");
    } catch (e) {
      console.error("Failed to resume chat", e);
      setConnStatus("error");
    }
  };

  const handleSetMode = async (modeId: string) => {
    if (!chatId) {
      return;
    }
    if (connStatus !== "connected") {
      toast.error("Session is not connected");
      return;
    }
    try {
      await setModeMutation.mutateAsync({ chatId, modeId });
      setCurrentModeId(modeId);
    } catch (e) {
      console.error("Failed to set mode", e);
      toast.error(e instanceof Error ? e.message : "Failed to set mode");
    }
  };

  const handleSetModel = async (modelId: string) => {
    if (!chatId) {
      return;
    }
    if (connStatus !== "connected") {
      toast.error("Session is not connected");
      return;
    }
    try {
      await setModelMutation.mutateAsync({ chatId, modelId });
      setCurrentModelId(modelId);
    } catch (e) {
      console.error("Failed to set model", e);
      const message = e instanceof Error ? e.message : "Failed to set model";
      const normalized = message.toLowerCase();
      if (
        normalized.includes("model switching") ||
        normalized.includes("method not found")
      ) {
        setAvailableModels([]);
        setCurrentModelId(null);
      }
      toast.error(message);
    }
  };

  const addUserMessage = useCallback(
    async (
      content: string,
      images?: { base64: string; mimeType: string }[],
      resources?: { uri: string; text: string; mimeType?: string }[],
      resourceLinks?: { uri: string; name: string; mimeType?: string }[]
    ) => {
      if (!chatId) {
        return;
      }

      setStatus("streaming");

      try {
        const res = await sendMessageMutation.mutateAsync({
          chatId,
          text: content,
          images,
          resources,
          resourceLinks,
        });

        if (res.stopReason === "cancelled") {
          updateMessagesState((prev) => [
            ...prev,
            {
              id: nanoid(),
              role: "assistant",
              parts: [{ type: "text", text: "🚫 Generation cancelled." }],
            },
          ]);
        } else if (res.stopReason === "max_tokens") {
          updateMessagesState((prev) => [
            ...prev,
            {
              id: nanoid(),
              role: "assistant",
              parts: [{ type: "text", text: "⚠️ Max tokens reached." }],
            },
          ]);
        }
      } catch (e) {
        console.error("Failed to send message", e);
        setConnStatus("error");
      } finally {
        setStatus("ready");
      }
    },
    [chatId, sendMessageMutation, updateMessagesState]
  );

  const handleSubmit = async (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasFiles = message.files.length > 0;
    const hasMentions = (message.mentions?.length ?? 0) > 0;
    if (!(hasText || hasFiles || hasMentions)) {
      return;
    }

    setStatus("submitted");
    isReplayingHistoryRef.current = false;

    const images: { base64: string; mimeType: string }[] = [];
    for (const filePart of message.files) {
      if (filePart.file?.type.startsWith("image/")) {
        try {
          const base64 = await convertFileToBase64(filePart.file);
          images.push({
            base64,
            mimeType: filePart.file.type,
          });
        } catch (e) {
          console.error("Failed to convert file to base64", e);
        }
      }
    }

    const mentionPaths = Array.from(new Set(message.mentions ?? []));
    const resources: { uri: string; text: string; mimeType?: string }[] = [];
    const resourceLinks: { uri: string; name: string; mimeType?: string }[] =
      [];

    const buildFileUri = (path: string) => {
      if (activeProject?.path) {
        const base = activeProject.path.replace(/\\/g, "/");
        return `file://${base}/${path}`;
      }
      return path;
    };

    if (mentionPaths.length > 0 && chatId) {
      if (promptCapabilities.embeddedContext) {
        const results = await Promise.allSettled(
          mentionPaths.map(async (path) => {
            const res = await utils.getFileContent.fetch({ chatId, path });
            return { path, content: res.content };
          })
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            resources.push({
              uri: buildFileUri(result.value.path),
              text: result.value.content,
              mimeType: "text/plain",
            });
          } else {
            console.error("Failed to load mention file", result.reason);
            toast.error("Failed to load referenced file.");
          }
        }
      } else {
        resourceLinks.push(
          ...mentionPaths.map((path) => ({
            uri: buildFileUri(path),
            name: path,
          }))
        );
      }
    }

    addUserMessage(
      message.text,
      images.length > 0 ? images : undefined,
      resources.length > 0 ? resources : undefined,
      resourceLinks.length > 0 ? resourceLinks : undefined
    );
  };

  const { data: projectContext } = trpc.getProjectContext.useQuery(
    { chatId: chatId || "" },
    { enabled: !!chatId }
  );

  const { setFiles } = useFileStore();
  const setActiveChatId = useChatStatusStore((state) => state.setActiveChatId);
  const setIsStreaming = useChatStatusStore((state) => state.setIsStreaming);

  useEffect(() => {
    setActiveChatId(chatId);
  }, [chatId, setActiveChatId]);

  useEffect(() => {
    const streaming = status === "streaming" || status === "submitted";
    setIsStreaming(connStatus === "connected" && streaming);
  }, [connStatus, status, setIsStreaming]);

  useEffect(() => {
    if (projectContext?.files) {
      setFiles(projectContext.files);
    }
  }, [projectContext, setFiles]);

  if (!chatId) {
    return (
      <>
        <div className="flex size-full flex-col items-center justify-center space-y-4 p-8 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
            <svg
              className="size-8 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect height="18" rx="2" ry="2" width="18" x="3" y="3" />
              <path d="M9 3v18" />
              <path d="m14 9 3 3-3 3" />
            </svg>
          </div>
          <div className="max-w-[420px] space-y-2">
            <h2 className="font-semibold text-2xl tracking-tight">
              Welcome to EraGear Code Copilot
            </h2>
            <p className="text-muted-foreground text-sm">
              To get started, please select a project from the sidebar or click
              the "+" button next to a project to create a new session.
            </p>
          </div>
        </div>
        <QuickSwitchDialog
          onOpenChange={setIsQuickSwitchOpen}
          onSelect={selectSession}
          open={isQuickSwitchOpen}
          sessions={quickSwitchSessions}
        />
      </>
    );
  }

  return (
    <div className="relative flex size-full flex-col divide-y overflow-hidden">
      <ChatHeader
        activeAgentId={activeAgentId || null}
        agentModels={agentsData?.agents || []}
        connStatus={connStatus}
        isResuming={resumeSessionMutation.isPending}
        onNewChat={handleNewChat}
        onResumeChat={loadSessionSupported ? handleResume : undefined}
        onStopChat={handleStopChat}
        projectName={activeProject?.name}
        resumeNotSupported={loadSessionSupported === false}
        sessionAgentInfo={sessionAgentInfo}
      />

      <ChatMessages
        messages={messages}
        onApprove={handleApproveTool}
        onReject={handleRejectTool}
        terminalOutputs={terminalOutputs}
      />

      <ChatInput
        activeTabs={projectContext?.activeTabs}
        availableCommands={availableCommands}
        availableModels={availableModels}
        availableModes={availableModes}
        connStatus={connStatus}
        currentModeId={currentModeId}
        currentModelId={currentModelId}
        onCancel={handleCancel}
        onModeChange={handleSetMode}
        onModelChange={handleSetModel}
        onSubmit={handleSubmit}
        projectRules={projectContext?.projectRules}
        status={status}
        textareaRef={textareaRef}
      />
      <QuickSwitchDialog
        onOpenChange={setIsQuickSwitchOpen}
        onSelect={selectSession}
        open={isQuickSwitchOpen}
        sessions={quickSwitchSessions}
      />
    </div>
  );
}

interface ToolCallContent {
  toolCallId: string;
  kind?: string;
  title?: string;
  status?: string;
  rawInput?: Record<string, unknown>;
  content?: Array<{
    type: string;
    text?: string;
    terminalId?: string;
    path?: string;
    oldText?: string;
    newText?: string;
  }>;
}

interface ToolCallUpdateContent {
  toolCallId: string;
  status?: string;
  content?: Array<{
    type: string;
    content?: { text: string };
    terminalId?: string;
    path?: string;
    oldText?: string;
    newText?: string;
  }>;
}
