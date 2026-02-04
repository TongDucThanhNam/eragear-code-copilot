/**
 * Chat Interface Component (Refactored)
 *
 * Uses the unified useChat hook for state management and tRPC communication.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { ChatHeader } from "@/components/chat-ui/chat-header";
import { ChatInput } from "@/components/chat-ui/chat-input";
import { ChatPlanDock } from "@/components/chat-ui/chat-plan-dock";
import { ChatMessages } from "@/components/chat-ui/chat-messages";
import { PermissionDialog } from "@/components/chat-ui/permission-dialog";
import { QuickSwitchDialog } from "@/components/chat-ui/quick-switch-dialog";
import { useChat } from "@/hooks/use-chat";
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
  const agentModels = useMemo(
    () => agentsData?.agents ?? [],
    [agentsData?.agents]
  );
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

  // Chat ID state (local, synced with initial prop)
  const [chatId, setChatId] = useState<string | null>(initialChatId || null);
  const [isQuickSwitchOpen, setIsQuickSwitchOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatIdRef = useRef<string | null>(initialChatId || null);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const handledPermissionIdRef = useRef<string | null>(null);
  const lastPermissionIdRef = useRef<string | null>(null);

  // Use the unified useChat hook
  const {
    messages,
    status,
    connStatus,
    isStreaming,
    pendingPermission,
    terminalOutputs,
    modes,
    models,
    commands,
    promptCapabilities,
    agentInfo: sessionAgentInfo,
    loadSessionSupported,
    isResuming,
    sendMessage,
    cancelPrompt,
    setMode: handleSetModeAction,
    setModel: handleSetModelAction,
    respondToPermission,
    stopSession,
    resumeSession,
    setMessages,
    restoreSessionState,
    setConnStatus,
    setStatus,
  } = useChat({
    chatId,
    readOnly: false,
    onError: (err) => {
      toast.error(err);
    },
  });

  // Derived state for UI
  const availableModes = useMemo(() => {
    if (!modes?.availableModes) {
      return [];
    }
    return modes.availableModes.map((m) => ({
      ...m,
      description: m.description || undefined,
    }));
  }, [modes?.availableModes]);
  const currentModeId = modes?.currentModeId || null;
  const availableModels = useMemo(() => {
    if (!models?.availableModels) {
      return [];
    }
    return models.availableModels.map((m) => ({
      modelId: m.modelId,
      name: m.name,
      description: m.description || undefined,
    }));
  }, [models?.availableModels]);
  const currentModelId = models?.currentModelId || null;
  const availableCommands = commands;

  // Quick switch sessions
  const quickSwitchSessions = useMemo(() => {
    return (sessionsData || [])
      .filter((session: { archived?: boolean }) => !session.archived)
      .sort(
        (
          a: { pinned?: boolean; lastActiveAt?: number },
          b: { pinned?: boolean; lastActiveAt?: number }
        ) => {
          const pinnedA = a.pinned ?? false;
          const pinnedB = b.pinned ?? false;
          if (pinnedA !== pinnedB) {
            return pinnedA ? -1 : 1;
          }
          return (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0);
        }
      )
      .map(
        (session: {
          id: string;
          name?: string | null;
          agentName?: string | null;
          projectId?: string | null;
        }) => ({
          id: session.id,
          name: session.name
            ? session.name
            : session.agentName
              ? session.agentName
              : `Session ${session.id.slice(0, 8)}`,
          projectName: session.projectId
            ? projectLookup[session.projectId]
            : null,
        })
      );
  }, [projectLookup, sessionsData]);

  const selectSession = useCallback(
    (id: string) => {
      setIsQuickSwitchOpen(false);
      onChatIdChange?.(id);
    },
    [onChatIdChange]
  );

  // Keyboard shortcuts
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
          (session: { id: string }) => session.id === chatIdRef.current
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

  // Sync chatId from prop changes
  useEffect(() => {
    if (initialChatId && initialChatId !== chatId) {
      utils.getSessionState.invalidate({ chatId: chatId || "" });
      utils.getSessionMessages.invalidate({ chatId: chatId || "" });
      setMessages([]);
      setChatId(initialChatId);
      chatIdRef.current = initialChatId;
      setConnStatus("connecting");
      setStatus("connecting");
    } else if (!initialChatId && chatId) {
      utils.getSessionState.invalidate({ chatId });
      utils.getSessionMessages.invalidate({ chatId });
      setChatId(null);
      chatIdRef.current = null;
      setConnStatus("idle");
      setMessages([]);
      setStatus("inactive");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChatId]);

  // Mutations for session creation
  const createSessionMutation = trpc.createSession.useMutation();
  const setActiveAgentMutation = trpc.agents.setActive.useMutation();

  useEffect(() => {
    const requestId = pendingPermission?.requestId ?? null;
    if (!requestId) {
      setPermissionDialogOpen(false);
      lastPermissionIdRef.current = null;
      return;
    }
    if (requestId !== lastPermissionIdRef.current) {
      lastPermissionIdRef.current = requestId;
      handledPermissionIdRef.current = null;
      setPermissionDialogOpen(true);
    }
  }, [pendingPermission?.requestId]);

  const handlePermissionDecision = useCallback(
    (decision: string) => {
      const requestId = pendingPermission?.requestId;
      if (!requestId || handledPermissionIdRef.current === requestId) {
        return;
      }
      handledPermissionIdRef.current = requestId;
      setPermissionDialogOpen(false);
      respondToPermission(requestId, decision);
    },
    [pendingPermission?.requestId, respondToPermission]
  );

  const defaultRejectDecision = useMemo(() => {
    const options = pendingPermission?.options;
    const list = Array.isArray(options) ? options : (options?.options ?? []);
    const fallback = "reject";
    if (list.length === 0) {
      return fallback;
    }
    const rejectOption = list.find((option) => {
      const id = String(
        option.optionId ??
          option.id ??
          option.kind ??
          option.name ??
          option.label ??
          ""
      ).toLowerCase();
      return id.includes("reject") || id.includes("deny") || id.includes("no");
    });
    if (!rejectOption) {
      return fallback;
    }
    return String(
      rejectOption.optionId ??
        rejectOption.id ??
        rejectOption.kind ??
        rejectOption.name ??
        rejectOption.label ??
        fallback
    );
  }, [pendingPermission?.options]);

  const handlePermissionApprove = useCallback(
    (decision: string) => {
      handlePermissionDecision(decision);
    },
    [handlePermissionDecision]
  );

  const handlePermissionReject = useCallback(
    (decision?: string) => {
      handlePermissionDecision(decision ?? defaultRejectDecision);
    },
    [defaultRejectDecision, handlePermissionDecision]
  );

  const handlePermissionDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setPermissionDialogOpen(true);
        return;
      }
      setPermissionDialogOpen(false);
      const requestId = pendingPermission?.requestId;
      if (!requestId || handledPermissionIdRef.current === requestId) {
        return;
      }
      handledPermissionIdRef.current = requestId;
      respondToPermission(requestId, defaultRejectDecision);
    },
    [defaultRejectDecision, pendingPermission?.requestId, respondToPermission]
  );

  useEffect(() => {
    if (chatId) {
      return;
    }
    setPermissionDialogOpen(false);
    handledPermissionIdRef.current = null;
    lastPermissionIdRef.current = null;
  }, [chatId]);

  // Session initialization
  const initChat = useCallback(
    async (agentId?: string) => {
      const targetId = agentId || activeAgentId;
      const agent = agentModels.find(
        (a: { id: string }) => a.id === targetId
      );
      const currentProject = useProjectStore.getState().getActiveProject();

      if (!agent) {
        console.warn("No active agent selected");
        setConnStatus("idle");
        setStatus("inactive");
        return;
      }
      if (!currentProject) {
        toast.error("Please select a project before starting a chat.");
        setConnStatus("idle");
        setStatus("inactive");
        return;
      }

      setConnStatus("connecting");
      setStatus("connecting");
      try {
        const data = await createSessionMutation.mutateAsync({
          projectId: currentProject.id,
          command: agent?.command,
          args: agent?.args,
          env: agent?.env,
        });

        setChatId(data.chatId);
        chatIdRef.current = data.chatId;

        if (onChatIdChange) {
          onChatIdChange(data.chatId);
        }

        // Apply session state from creation response
        restoreSessionState({
          chatStatus: data.chatStatus,
          modes: data.modes
            ? {
                currentModeId: data.modes.currentModeId || "",
                availableModes: data.modes.availableModes,
              }
            : undefined,
          models: data.models
            ? {
                currentModelId: data.models.currentModelId || "",
                availableModels: data.models.availableModels,
              }
            : undefined,
          promptCapabilities: data.promptCapabilities,
          loadSessionSupported: data.loadSessionSupported ?? false,
          agentInfo: data.agentInfo ?? null,
        });

        setConnStatus("connected");
      } catch (e) {
        console.error("Failed to init chat", e);
        setConnStatus("error");
        setStatus("error");
      }
    },
    [
      createSessionMutation,
      onChatIdChange,
      agentModels,
      activeAgentId,
      restoreSessionState,
      setConnStatus,
      setStatus,
    ]
  );

  const handleNewChat = useCallback(
    (agentId: string) => {
      setMessages([]);
      setChatId(null);
      chatIdRef.current = null;
      useDiffStore.getState().clearDiffs();

      if (onChatIdChange) {
        onChatIdChange(null);
      }

      setActiveAgentMutation.mutate({ id: agentId });
      initChat(agentId);
    },
    [initChat, onChatIdChange, setActiveAgentMutation, setChatId, setMessages]
  );

  const handleStopChat = useCallback(async () => {
    const targetChatId = chatIdRef.current;
    if (!targetChatId) {
      return;
    }
    try {
      await stopSession();
      setChatId(null);
      chatIdRef.current = null;

      if (onChatIdChange) {
        onChatIdChange(null);
      }
    } catch (e) {
      console.error("Failed to stop chat", e);
    }
  }, [onChatIdChange, setChatId, stopSession]);

  const handleCancel = useCallback(async () => {
    if (!chatId) {
      return;
    }
    try {
      await cancelPrompt();
    } catch (e) {
      console.error("Failed to cancel prompt", e);
    }
  }, [cancelPrompt, chatId]);

  const handleResume = useCallback(async () => {
    if (!chatId) {
      return;
    }
    try {
      await resumeSession();
    } catch (e) {
      console.error("Failed to resume chat", e);
    }
  }, [chatId, resumeSession]);

  const handleSetMode = useCallback(
    async (modeId: string) => {
      if (!chatId) {
        return;
      }
      if (connStatus !== "connected") {
        toast.error("Session is not connected");
        return;
      }
      try {
        await handleSetModeAction(modeId);
      } catch (e) {
        console.error("Failed to set mode", e);
        toast.error(e instanceof Error ? e.message : "Failed to set mode");
      }
    },
    [chatId, connStatus, handleSetModeAction]
  );

  const handleSetModel = useCallback(
    async (modelId: string) => {
      if (!chatId) {
        return;
      }
      if (connStatus !== "connected") {
        toast.error("Session is not connected");
        return;
      }
      try {
        await handleSetModelAction(modelId);
      } catch (e) {
        console.error("Failed to set model", e);
        toast.error(e instanceof Error ? e.message : "Failed to set model");
      }
    },
    [chatId, connStatus, handleSetModelAction]
  );

  // Handle submit
  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (connStatus !== "connected") {
        toast.error("Session is not connected");
        return;
      }
      const hasText = Boolean(message.text);
      const hasFiles = message.files.length > 0;
      const hasMentions = (message.mentions?.length ?? 0) > 0;
      if (!(hasText || hasFiles || hasMentions)) {
        return;
      }

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
        if (promptCapabilities?.embeddedContext) {
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

      sendMessage(message.text, {
        images: images.length > 0 ? images : undefined,
        resources: resources.length > 0 ? resources : undefined,
        resourceLinks: resourceLinks.length > 0 ? resourceLinks : undefined,
      });
    },
    [
      activeProject,
      chatId,
      connStatus,
      promptCapabilities?.embeddedContext,
      sendMessage,
      utils.getFileContent,
    ]
  );

  // Project context
  const { data: projectContext } = trpc.getProjectContext.useQuery(
    { chatId: chatId || "" },
    { enabled: !!chatId }
  );

  const { setFiles } = useFileStore();
  const setActiveChatId = useChatStatusStore((state) => state.setActiveChatId);
  const setIsStreamingStatus = useChatStatusStore(
    (state) => state.setIsStreaming
  );

  useEffect(() => {
    setActiveChatId(chatId);
  }, [chatId, setActiveChatId]);

  useEffect(() => {
    setIsStreamingStatus(connStatus === "connected" && isStreaming);
  }, [connStatus, isStreaming, setIsStreamingStatus]);

  useEffect(() => {
    if (projectContext?.files) {
      setFiles(projectContext.files);
    }
  }, [projectContext, setFiles]);

  // Empty state
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
              <title>Empty</title>
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
        agentModels={agentModels}
        connStatus={connStatus}
        isResuming={isResuming}
        onNewChat={handleNewChat}
        onResumeChat={loadSessionSupported ? handleResume : undefined}
        onStopChat={handleStopChat}
        projectName={activeProject?.name}
        resumeNotSupported={loadSessionSupported === false}
        sessionAgentInfo={sessionAgentInfo}
      />

      <ChatMessages
        messages={messages}
        terminalOutputs={terminalOutputs}
      />

      <div className="relative">
        <ChatPlanDock messages={messages} />
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
      </div>
      <QuickSwitchDialog
        onOpenChange={setIsQuickSwitchOpen}
        onSelect={selectSession}
        open={isQuickSwitchOpen}
        sessions={quickSwitchSessions}
      />
      <PermissionDialog
        onApprove={handlePermissionApprove}
        onOpenChange={handlePermissionDialogOpenChange}
        onReject={handlePermissionReject}
        open={permissionDialogOpen}
        request={pendingPermission}
      />
    </div>
  );
}
