import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveSessionSelectionState } from "@repo/shared";
import { toast } from "sonner";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { resolveSessionBootstrapPhase } from "@/components/chat-ui/chat-bootstrap-phase";
import {
  normalizeInteractionConnStatus,
  resolveDisplayConnStatus,
} from "@/components/chat-ui/chat-connection-display";
import { ChatHeader } from "@/components/chat-ui/chat-header";
import { ChatMessagesPane } from "@/components/chat-ui/chat-interface/chat-messages-pane";
import { ChatPlanDockPane } from "@/components/chat-ui/chat-interface/chat-plan-dock-pane";
import { ChatInput } from "@/components/chat-ui/chat-input";
import {
  resolveLocalCommand,
  visibleSlashCommandName,
} from "@/components/chat-ui/local-command";
import {
  buildMcpToolResultPrompt,
  MCP_COMMAND_NAME,
  parseMcpCommand,
  type ParsedMcpCommand,
  resolveMcpCommandServer,
} from "@/components/chat-ui/mcp-command";
import {
  outputStyleSlashCommandName,
  resolveLocalInstructionCommand,
  skillSlashCommandName,
} from "@/components/chat-ui/local-instruction";
import { PermissionDialog } from "@/components/chat-ui/permission-dialog";
import {
  AUTO_PROJECT_INDEX_CONTEXT_LIMIT,
  shouldAutoAttachProjectIndexContext,
  shouldUseAutoProjectIndexSearchResult,
} from "@/components/chat-ui/project-index-auto-context";
import {
  parseProjectIndexCommand,
  PROJECT_INDEX_COMMAND_NAME,
} from "@/components/chat-ui/project-index-command";
import {
  AUTO_PROJECT_MEMORY_CONTEXT_BYTES,
  composeProjectContextPrompt,
  shouldAutoAttachProjectMemoryContext,
  shouldUseProjectMemoryContextResult,
} from "@/components/chat-ui/project-memory-auto-context";
import {
  parseProjectMemoryCommand,
  PROJECT_MEMORY_COMMAND_NAME,
} from "@/components/chat-ui/project-memory-command";
import { QuickSwitchDialog } from "@/components/chat-ui/quick-switch-dialog";
import {
  resolveSubagentCommand,
  subagentSlashCommandName,
} from "@/components/chat-ui/subagent-command";
import { LocalAdeControlCenter } from "@/components/local-ade/local-ade-control-center";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import { useChat } from "@/hooks/use-chat";
import { chatDebug } from "@/hooks/use-chat-debug";
import { prepareImageForPrompt } from "@/lib/image-prompt";
import { trpc } from "@/lib/trpc";
import {
  type SessionBootstrapPhase,
  useChatStatusStore,
} from "@/store/chat-status-store";
import {
  useChatMessageCount,
} from "@/store/chat-stream-store";
import { useFileStore } from "@/store/file-store";
import { useProjectStore } from "@/store/project-store";

interface ChatInterfaceProps {
  initialChatId?: string | null;
  onChatIdChange?: (chatId: string | null) => void;
}

function getBootstrapPhaseLabel(phase: SessionBootstrapPhase): string {
  switch (phase) {
    case "creating_session":
      return "Creating session...";
    case "initializing_agent":
      return "ACP agent initializing...";
    case "restoring_history":
      return "Restoring history...";
    case "idle":
    default:
      return "Loading session...";
  }
}

const REJECT_KEYWORDS = new Set([
  "reject",
  "rejected",
  "deny",
  "denied",
  "block",
  "blocked",
  "cancel",
  "cancelled",
  "decline",
  "declined",
  "disallow",
  "no",
]);

function normalizePermissionToken(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function hasRejectKeyword(value: string): boolean {
  const normalized = normalizePermissionToken(value);
  if (normalized.length === 0) {
    return false;
  }
  const tokens = [
    normalized,
    ...normalized.split(/[^a-z0-9]+/).filter((part) => part.length > 0),
  ];
  return tokens.some((token) => REJECT_KEYWORDS.has(token));
}

function getRejectDecision(
  options:
    | Array<Record<string, unknown>>
    | { options?: Array<Record<string, unknown>> }
    | undefined
): string | null {
  const list = Array.isArray(options) ? options : (options?.options ?? []);
  if (list.length === 0) {
    return "reject";
  }
  const rejectOption = list.find((option) => {
    const kind = normalizePermissionToken(option.kind);
    if (kind.startsWith("reject_")) {
      return true;
    }
    const values = [
      option.optionId,
      option.id,
      option.kind,
      option.name,
      option.label,
    ]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    return values.some((value) => hasRejectKeyword(value));
  });
  if (!rejectOption) {
    return null;
  }
  const resolvedValue =
    rejectOption.optionId ??
    rejectOption.id ??
    rejectOption.kind ??
    rejectOption.name ??
    rejectOption.label;
  if (typeof resolvedValue !== "string") {
    return null;
  }
  const normalized = resolvedValue.trim();
  return normalized.length > 0 ? normalized : null;
}

export function ChatInterface({
  initialChatId,
  onChatIdChange,
}: ChatInterfaceProps) {
  const utils = trpc.useUtils();
  const { data: agentsData, isLoading: isAgentsLoading } =
    trpc.agents.list.useQuery();
  const sessionsPageQuery = trpc.getSessionsPage.useInfiniteQuery(
    { limit: 500 },
    {
      refetchInterval: 5000,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }
  );
  useEffect(() => {
    if (
      !(sessionsPageQuery.hasNextPage && !sessionsPageQuery.isFetchingNextPage)
    ) {
      return;
    }
    void sessionsPageQuery.fetchNextPage();
  }, [
    sessionsPageQuery.fetchNextPage,
    sessionsPageQuery.hasNextPage,
    sessionsPageQuery.isFetchingNextPage,
  ]);
  const sessionsData = useMemo(
    () => sessionsPageQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [sessionsPageQuery.data]
  );
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
  const sessionBootstrapPhase = useChatStatusStore(
    (state) => state.sessionBootstrapPhase
  );
  const setSessionBootstrapPhase = useChatStatusStore(
    (state) => state.setSessionBootstrapPhase
  );

  const [uncontrolledChatId, setUncontrolledChatId] = useState<string | null>(
    initialChatId || null
  );
  const isChatIdControlled = typeof onChatIdChange === "function";
  const chatId = isChatIdControlled
    ? (initialChatId ?? null)
    : uncontrolledChatId;
  const [isQuickSwitchOpen, setIsQuickSwitchOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatIdRef = useRef<string | null>(chatId);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const handledPermissionIdRef = useRef<string | null>(null);
  const lastPermissionIdRef = useRef<string | null>(null);
  chatIdRef.current = chatId;
  const handleChatError = useCallback((err: string) => {
    toast.error(err);
  }, []);
  // Use the unified useChat hook
  const {
    status,
    connStatus,
    isStreaming,
    pendingPermission,
    modes,
    models,
    commands,
    configOptions,
    promptCapabilities,
    agentInfo: sessionAgentInfo,
    loadSessionSupported,
    error,
    isResuming,
    hasMoreHistory,
    isLoadingOlderHistory,
    sendMessage,
    cancelPrompt,
    setMode: handleSetModeAction,
    setModel: handleSetModelAction,
    setConfigOption: handleSetConfigOptionAction,
    respondToPermission,
    stopSession,
    resumeSession,
    setSupervisorMode,
    supervisor,
    supervisorCapable,
    lastSupervisorDecision,
    isSettingSupervisorMode,
    refreshHistory,
    loadOlderHistory,
    setConnStatus,
    setStatus,
  } = useChat({
    chatId,
    readOnly: false,
    onError: handleChatError,
  });
  const { data: localAdeSnapshot } = trpc.settings.getLocalAdeSnapshot.useQuery(
    undefined,
    { staleTime: 10_000 }
  );
  const invokeMcpTool = trpc.settings.invokeMcpTool.useMutation();
  const activePendingPermission =
    pendingPermission?.requestId &&
    pendingPermission.requestId === handledPermissionIdRef.current
      ? null
      : pendingPermission;
  const createSessionMutation = trpc.createSession.useMutation();
  const messageCount = useChatMessageCount(chatId);
  const selectedSession = useMemo(() => {
    if (!chatId) return undefined;
    return sessionsData.find((session: any) => session.id === chatId);
  }, [chatId, sessionsData]);
  const displayConnStatus = useMemo(
    () =>
      resolveDisplayConnStatus({
        status,
        connStatus,
        sessionIsActive:
          typeof selectedSession?.isActive === "boolean"
            ? selectedSession.isActive
            : null,
      }),
    [connStatus, selectedSession?.isActive, status]
  );
  const effectiveConnStatus = useMemo(
    () => normalizeInteractionConnStatus(displayConnStatus),
    [displayConnStatus]
  );
  const selectedSessionLoadSupported = useMemo(() => {
    if (!selectedSession) {
      return undefined;
    }
    const loadFlag = (selectedSession as any).loadSessionSupported;
    if (typeof loadFlag === "boolean") {
      return loadFlag;
    }
    const capabilities = (selectedSession as any).agentCapabilities as
      | Record<string, unknown>
      | undefined;
    if (!capabilities) {
      return undefined;
    }
    if (capabilities.loadSession === true) {
      return true;
    }
    const sessionCapabilities = capabilities.sessionCapabilities as
      | Record<string, unknown>
      | undefined;
    if (sessionCapabilities?.resume) {
      return true;
    }
    return undefined;
  }, [selectedSession]);
  const resolvedLoadSessionSupported =
    loadSessionSupported ?? selectedSessionLoadSupported;
  const hasResolvedSessionList = !(
    sessionsPageQuery.isLoading ||
    sessionsPageQuery.isFetching ||
    sessionsPageQuery.hasNextPage
  );
  const canAutoClearMissingChat =
    sessionBootstrapPhase === "idle" &&
    status === "inactive" &&
    effectiveConnStatus === "idle";
  useEffect(() => {
    if (
      !chatId ||
      selectedSession ||
      !hasResolvedSessionList ||
      !canAutoClearMissingChat
    ) {
      return;
    }
    if (onChatIdChange) {
      onChatIdChange(null);
      return;
    }
    setUncontrolledChatId(null);
  }, [
    canAutoClearMissingChat,
    chatId,
    hasResolvedSessionList,
    onChatIdChange,
    selectedSession,
  ]);

  const agentDisplay = useMemo(() => {
    const selectedAgent = agentModels.find(
      (agent) => agent.id === activeAgentId
    );
    const sessionLabel = sessionAgentInfo?.title ?? sessionAgentInfo?.name;

    // 1. If agent sent live metadata, use it as highest priority
    if (sessionAgentInfo && sessionLabel) {
      return {
        name: sessionLabel,
        source: "session" as const,
        version: sessionAgentInfo.version,
      };
    }
    // 2. Fallback to the saved agent name retrieved from database join
    if (selectedSession && (selectedSession as any).agentName) {
      return {
        name: (selectedSession as any).agentName,
        source: "session" as const,
      };
    }
    // 3. Fallback to active agent ONLY if not viewing an existing session
    if (selectedAgent?.name && !chatId) {
      return {
        name: selectedAgent.name,
        source: "selected" as const,
      };
    }

    return {
      name: "No Agent",
      source: "fallback" as const,
    };
  }, [activeAgentId, agentModels, sessionAgentInfo, selectedSession, chatId]);

  // Derived state for UI
  const selectionState = useMemo(
    () =>
      resolveSessionSelectionState({
        configOptions,
        modes,
        models,
      }),
    [configOptions, models, modes]
  );
  const currentModeId = selectionState.modes?.currentModeId || null;
  const availableModes = useMemo(() => {
    const mapped = (selectionState.modes?.availableModes ?? []).map((mode) => ({
      ...mode,
      description: mode.description || undefined,
    }));
    if (!currentModeId) {
      return mapped;
    }
    if (mapped.some((mode) => mode.id === currentModeId)) {
      return mapped;
    }
    // Preserve visibility of current selection even when agent omits options.
    return [
      ...mapped,
      {
        id: currentModeId,
        name: currentModeId,
        description: undefined,
      },
    ];
  }, [currentModeId, selectionState.modes?.availableModes]);
  const currentModelId = selectionState.models?.currentModelId || null;
  const availableModels = useMemo(() => {
    const mapped = (selectionState.models?.availableModels ?? []).map((model) => ({
      modelId: model.modelId,
      name: model.name,
      description: model.description || undefined,
      provider: model.provider,
      providers: model.providers,
    }));
    if (!currentModelId) {
      return mapped;
    }
    if (mapped.some((model) => model.modelId === currentModelId)) {
      return mapped;
    }
    return [
      ...mapped,
      {
        modelId: currentModelId,
        name: currentModelId,
        description: undefined,
      },
    ];
  }, [currentModelId, selectionState.models?.availableModels]);
  const localSlashCommands = useMemo(
    () =>
      (localAdeSnapshot?.commands ?? [])
        .filter((command) => command.enabled)
        .map((command) => ({
          name: visibleSlashCommandName(command.name),
          description:
            command.description ??
            command.diagnostics?.[0] ??
            "Project-local command",
          input: { hint: command.argumentHint ?? command.sourcePath },
        })),
    [localAdeSnapshot?.commands]
  );
  const localSkillCommands = useMemo(
    () =>
      (localAdeSnapshot?.skills ?? [])
        .filter((skill) => skill.enabled)
        .map((skill) => ({
          name: skillSlashCommandName(skill.name),
          description:
            skill.description ??
            skill.diagnostics?.[0] ??
            `Use ${skill.name} as a local skill`,
          input: { hint: skill.sourcePath },
        })),
    [localAdeSnapshot?.skills]
  );
  const localOutputStyleCommands = useMemo(
    () =>
      (localAdeSnapshot?.outputStyles ?? [])
        .filter((style) => style.enabled)
        .map((style) => ({
          name: outputStyleSlashCommandName(style.name),
          description:
            style.description ??
            style.diagnostics?.[0] ??
            `Respond using ${style.name}`,
          input: { hint: style.sourcePath },
        })),
    [localAdeSnapshot?.outputStyles]
  );
  const localSubagentCommands = useMemo(
    () =>
      (localAdeSnapshot?.subagents ?? [])
        .filter((subagent) => subagent.enabled)
        .map((subagent) => ({
          name: subagentSlashCommandName(subagent.name),
          description:
            subagent.description ??
            `Invoke ${subagent.name} as a delegated subagent profile`,
          input: { hint: subagent.sourcePath },
        })),
    [localAdeSnapshot?.subagents]
  );
  const mcpSlashCommands = useMemo(() => {
    const hasInvokableTool = (localAdeSnapshot?.mcp.servers ?? []).some(
      (server) =>
        server.enabled &&
        server.trustStatus === "trusted" &&
        server.protocol.status === "initialized" &&
        server.tools.length > 0
    );
    if (!hasInvokableTool) {
      return [];
    }
    return [
      {
        name: MCP_COMMAND_NAME,
        description: "Invoke a trusted MCP tool and send the result to the agent",
        input: {
          hint: '[--server <id>] <tool> {"key":"value"} [-- request]',
        },
      },
    ];
  }, [localAdeSnapshot?.mcp.servers]);
  const projectIndexCommands = useMemo(
    () => [
      {
        name: PROJECT_INDEX_COMMAND_NAME,
        description: "Search Project Index and send matched symbols/tasks to the agent",
        input: { hint: "<symbol, file, task, or topic>" },
      },
    ],
    []
  );
  const projectMemoryCommands = useMemo(
    () => [
      {
        name: PROJECT_MEMORY_COMMAND_NAME,
        description: "Attach enabled project memory sources to this prompt",
        input: { hint: "[--source AGENTS.md] <request>" },
      },
    ],
    []
  );
  const availableCommands = useMemo(
    () => [
      ...commands,
      ...projectIndexCommands,
      ...projectMemoryCommands,
      ...mcpSlashCommands,
      ...localSlashCommands,
      ...localSkillCommands,
      ...localOutputStyleCommands,
      ...localSubagentCommands,
    ],
    [
      commands,
      localOutputStyleCommands,
      localSkillCommands,
      localSlashCommands,
      localSubagentCommands,
      mcpSlashCommands,
      projectIndexCommands,
      projectMemoryCommands,
    ]
  );
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
      if (onChatIdChange) {
        onChatIdChange(id);
        return;
      }
      setUncontrolledChatId(id);
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
          if (onChatIdChange) {
            onChatIdChange(nextSession.id);
          } else {
            setUncontrolledChatId(nextSession.id);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onChatIdChange, quickSwitchSessions]);

  useEffect(() => {
    const requestId = activePendingPermission?.requestId ?? null;
    if (!requestId) {
      chatDebug("permission", "chat interface closing permission dialog", {
        chatId: chatId ?? null,
        pendingRequestId: pendingPermission?.requestId ?? null,
        activeRequestId: null,
        dialogOpen: permissionDialogOpen,
        handledRequestId: handledPermissionIdRef.current,
      });
      setPermissionDialogOpen(false);
      lastPermissionIdRef.current = null;
      return;
    }
    if (requestId !== lastPermissionIdRef.current) {
      chatDebug("permission", "chat interface opening permission dialog", {
        chatId: chatId ?? null,
        pendingRequestId: pendingPermission?.requestId ?? null,
        activeRequestId: requestId,
        previousRequestId: lastPermissionIdRef.current,
        dialogOpen: permissionDialogOpen,
        handledRequestId: handledPermissionIdRef.current,
      });
      lastPermissionIdRef.current = requestId;
      handledPermissionIdRef.current = null;
      setPermissionDialogOpen(true);
    }
  }, [
    activePendingPermission?.requestId,
    chatId,
    pendingPermission?.requestId,
    permissionDialogOpen,
  ]);

  useEffect(() => {
    chatDebug("permission", "chat interface permission state changed", {
      chatId: chatId ?? null,
      pendingRequestId: pendingPermission?.requestId ?? null,
      activeRequestId: activePendingPermission?.requestId ?? null,
      dialogOpen: permissionDialogOpen,
      visible: permissionDialogOpen || Boolean(activePendingPermission),
      handledRequestId: handledPermissionIdRef.current,
      lastRequestId: lastPermissionIdRef.current,
    });
  }, [
    activePendingPermission?.requestId,
    chatId,
    pendingPermission?.requestId,
    permissionDialogOpen,
  ]);

  const handlePermissionDecision = useCallback(
    async (decision: string) => {
      const requestId = activePendingPermission?.requestId;
      if (!requestId || handledPermissionIdRef.current === requestId) {
        return;
      }
      try {
        await respondToPermission(requestId, decision);
        handledPermissionIdRef.current = requestId;
        setPermissionDialogOpen(false);
      } catch (error) {
        console.error("Failed to resolve permission request", error);
        toast.error("Could not submit permission decision. Please try again.");
        setPermissionDialogOpen(true);
      }
    },
    [activePendingPermission?.requestId, respondToPermission]
  );

  const defaultRejectDecision = useMemo(() => {
    return getRejectDecision(
      (activePendingPermission?.options as
        | Array<Record<string, unknown>>
        | { options?: Array<Record<string, unknown>> }
        | undefined) ?? undefined
    );
  }, [activePendingPermission?.options]);

  const handlePermissionSelect = useCallback(
    (decision: string) => {
      void handlePermissionDecision(decision);
    },
    [handlePermissionDecision]
  );

  const handlePermissionApprove = useCallback(
    (decision: string) => {
      void handlePermissionDecision(decision);
    },
    [handlePermissionDecision]
  );

  const handlePermissionReject = useCallback(
    (decision?: string) => {
      const resolvedDecision = decision ?? defaultRejectDecision;
      if (!resolvedDecision) {
        setPermissionDialogOpen(true);
        return;
      }
      void handlePermissionDecision(resolvedDecision);
    },
    [defaultRejectDecision, handlePermissionDecision]
  );

  const handlePermissionDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setPermissionDialogOpen(true);
        return;
      }
      const requestId = activePendingPermission?.requestId;
      if (!requestId || handledPermissionIdRef.current === requestId) {
        setPermissionDialogOpen(false);
        return;
      }
      if (!defaultRejectDecision) {
        setPermissionDialogOpen(true);
        return;
      }
      void handlePermissionDecision(defaultRejectDecision);
    },
    [
      defaultRejectDecision,
      handlePermissionDecision,
      activePendingPermission?.requestId,
    ]
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
      const agent = agentModels.find((a: { id: string }) => a.id === targetId);
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

      setSessionBootstrapPhase("creating_session");
      setConnStatus("connecting");
      setStatus("connecting");
      try {
        const data = await createSessionMutation.mutateAsync({
          projectId: currentProject.id,
          agentId: agent?.id,
        });

        setSessionBootstrapPhase("initializing_agent");
        if (onChatIdChange) {
          onChatIdChange(data.chatId);
        } else {
          setUncontrolledChatId(data.chatId);
        }
      } catch (e) {
        console.error("Failed to init chat", e);
        setConnStatus("error");
        setStatus("error");
        setSessionBootstrapPhase("idle");
      }
    },
    [
      setSessionBootstrapPhase,
      createSessionMutation,
      onChatIdChange,
      agentModels,
      activeAgentId,
      setConnStatus,
      setStatus,
    ]
  );

  const handleStopChat = useCallback(async () => {
    const targetChatId = chatIdRef.current;
    if (!targetChatId) {
      return;
    }
    try {
      await stopSession();

      if (onChatIdChange) {
        onChatIdChange(null);
      } else {
        setUncontrolledChatId(null);
      }
    } catch (e) {
      console.error("Failed to stop chat", e);
    }
  }, [onChatIdChange, stopSession]);

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

  const handleLoadOlderHistory = useCallback(() => {
    void loadOlderHistory();
  }, [loadOlderHistory]);

  const handleSetMode = useCallback(
    async (modeId: string) => {
      if (!chatId) {
        return;
      }
      if (effectiveConnStatus !== "connected") {
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
    [chatId, effectiveConnStatus, handleSetModeAction]
  );

  const handleSetModel = useCallback(
    async (modelId: string) => {
      if (!chatId) {
        return;
      }
      if (effectiveConnStatus !== "connected") {
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
    [chatId, effectiveConnStatus, handleSetModelAction]
  );

  const handleSetConfigOption = useCallback(
    async (configId: string, value: string) => {
      if (!chatId) {
        return;
      }
      if (effectiveConnStatus !== "connected") {
        toast.error("Session is not connected");
        return;
      }
      try {
        await handleSetConfigOptionAction(configId, value);
      } catch (e) {
        console.error("Failed to set config option", e);
        toast.error(
          e instanceof Error ? e.message : "Failed to set config option"
        );
      }
    },
    [chatId, effectiveConnStatus, handleSetConfigOptionAction]
  );

  const handleSetSupervisorMode = useCallback(
    async (mode: "off" | "full_autopilot") => {
      if (!chatId) {
        return;
      }
      await setSupervisorMode(mode);
    },
    [chatId, setSupervisorMode]
  );

  // Handle submit
  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (effectiveConnStatus !== "connected") {
        toast.error("Session is not connected");
        return;
      }
      const hasText = Boolean(message.text);
      const hasFiles = message.files.length > 0;
      const hasMentions = (message.mentions?.length ?? 0) > 0;
      if (!(hasText || hasFiles || hasMentions)) {
        return;
      }

      const imageFiles = message.files.filter((filePart) =>
        filePart.file?.type.startsWith("image/")
      );
      const images: { base64: string; mimeType: string }[] = [];
      const imageErrors: string[] = [];
      for (const filePart of imageFiles) {
        const file = filePart.file;
        if (!file) {
          continue;
        }
        try {
          const result = await prepareImageForPrompt(file);
          if (result.ok) {
            images.push({
              base64: result.image.base64,
              mimeType: result.image.mimeType,
            });
          } else {
            console.error("Image processing failed", {
              name: file.name,
              size: file.size,
              error: result.error,
            });
            imageErrors.push(`${file.name}: ${result.error.message}`);
          }
        } catch (error) {
          console.error("Image processing threw", {
            name: file.name,
            size: file.size,
            error,
          });
          imageErrors.push(`${file.name}: Failed to process image.`);
        }
      }

      if (imageErrors.length > 0) {
        toast.error(
          imageErrors.length === 1
            ? imageErrors[0]
            : `${imageErrors.length} images could not be processed.`
        );
      }
      if (imageFiles.length > 0 && images.length === 0) {
        throw new Error("Image processing failed");
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

      let mcpCommandPrompt: string | null = null;
      let mcpCommand: ParsedMcpCommand | null = null;
      try {
        mcpCommand = parseMcpCommand(message.text);
      } catch (mcpParseError) {
        const message =
          mcpParseError instanceof Error
            ? mcpParseError.message
            : "Invalid MCP command.";
        toast.error(message);
        throw mcpParseError;
      }
      if (mcpCommand) {
        const resolvedMcp = resolveMcpCommandServer({
          command: mcpCommand,
          servers: localAdeSnapshot?.mcp.servers ?? [],
        });
        if (resolvedMcp.status !== "ready") {
          toast.error(resolvedMcp.message);
          throw new Error(`MCP_COMMAND_${resolvedMcp.status.toUpperCase()}`);
        }

        const invocation = await invokeMcpTool.mutateAsync({
          ...(activeProjectId ? { projectId: activeProjectId } : {}),
          serverId: resolvedMcp.server.id,
          toolName: resolvedMcp.toolName,
          arguments: mcpCommand.arguments,
        });
        if (invocation.status === "failed") {
          const detail =
            invocation.diagnostics.at(-1) ??
            `MCP tool "${resolvedMcp.toolName}" failed.`;
          toast.error(detail);
          throw new Error("MCP_COMMAND_INVOCATION_FAILED");
        }

        mcpCommandPrompt = buildMcpToolResultPrompt({
          command: { ...mcpCommand, toolName: resolvedMcp.toolName },
          result: invocation,
        });
        toast.success(`MCP tool "${resolvedMcp.toolName}" invoked.`);
      }

      const projectMemoryCommand = mcpCommandPrompt
        ? null
        : parseProjectMemoryCommand(message.text);
      let projectMemoryPrompt: string | null = null;
      if (projectMemoryCommand) {
        if (!projectMemoryCommand.query) {
          toast.error("Add a request after /memory.");
          throw new Error("PROJECT_MEMORY_QUERY_REQUIRED");
        }
        const memoryContext = await utils.settings.buildProjectMemoryContext.fetch({
          query: projectMemoryCommand.query,
          sourcePaths:
            projectMemoryCommand.sourcePaths.length > 0
              ? projectMemoryCommand.sourcePaths
              : undefined,
        });
        if (memoryContext.status === "no-enabled-sources") {
          toast.error("Enable a project memory source in Local ADE first.");
          throw new Error("PROJECT_MEMORY_NOT_READY");
        }
        projectMemoryPrompt = memoryContext.prompt;
      }

      const projectIndexCommand = projectMemoryPrompt || mcpCommandPrompt
        ? null
        : parseProjectIndexCommand(message.text);
      let projectIndexPrompt: string | null = null;
      if (projectIndexCommand) {
        if (!projectIndexCommand.query) {
          toast.error("Add a search query after /index.");
          throw new Error("PROJECT_INDEX_QUERY_REQUIRED");
        }
        const indexSearch = await utils.settings.searchProjectIndex.fetch({
          query: projectIndexCommand.query,
          limit: 12,
        });
        if (indexSearch.status === "not-indexed") {
          toast.error("Refresh Project Index in Local ADE Control Center first.");
          throw new Error("PROJECT_INDEX_NOT_READY");
        }
        if (indexSearch.status === "no-results") {
          toast.info("No direct Project Index matches; sending the no-match context.");
        }
        projectIndexPrompt = indexSearch.prompt;
      }

      const subagentCommand = projectMemoryPrompt || projectIndexPrompt || mcpCommandPrompt
        ? null
        : resolveSubagentCommand({
            text: message.text,
            subagents: localAdeSnapshot?.subagents ?? [],
          });
      const localCommand = subagentCommand || projectMemoryPrompt || projectIndexPrompt || mcpCommandPrompt
        ? null
        : resolveLocalCommand({
            text: message.text,
            commands: localAdeSnapshot?.commands ?? [],
          });
      const localInstruction = projectMemoryPrompt || projectIndexPrompt || subagentCommand || localCommand || mcpCommandPrompt
        ? null
        : resolveLocalInstructionCommand({
            text: message.text,
            skills: localAdeSnapshot?.skills ?? [],
            outputStyles: localAdeSnapshot?.outputStyles ?? [],
          });
      let autoProjectIndexPrompt: string | null = null;
      const commandResolved = Boolean(
          projectMemoryPrompt ||
          projectIndexPrompt ||
          mcpCommandPrompt ||
          subagentCommand ||
          localCommand ||
          localInstruction
      );
      if (
        shouldAutoAttachProjectIndexContext({
          text: message.text,
          hasFiles,
          mentionCount: mentionPaths.length,
          projectIndexReady: Boolean(localAdeSnapshot?.projectIndex.indexedAt),
          commandResolved,
        })
      ) {
        try {
          const indexSearch = await utils.settings.searchProjectIndex.fetch({
            query: message.text,
            limit: AUTO_PROJECT_INDEX_CONTEXT_LIMIT,
          });
          if (
            shouldUseAutoProjectIndexSearchResult({
              status: indexSearch.status,
              resultCount: indexSearch.results.length,
            })
          ) {
            autoProjectIndexPrompt = indexSearch.prompt;
            toast.info(
              `Attached Project Index context (${indexSearch.results.length} matches).`
            );
          }
        } catch (indexError) {
          console.error("Automatic Project Index context failed", indexError);
        }
      }
      let autoProjectMemoryPrompt: string | null = null;
      const enabledMemorySources =
        localAdeSnapshot?.projectMemory.sources.filter((source) => source.enabled)
          .length ?? 0;
      if (
        shouldAutoAttachProjectMemoryContext({
          text: message.text,
          hasFiles,
          mentionCount: mentionPaths.length,
          enabledMemorySources,
          commandResolved,
        })
      ) {
        try {
          const memoryContext = await utils.settings.buildProjectMemoryContext.fetch({
            query: message.text,
            maxBytes: AUTO_PROJECT_MEMORY_CONTEXT_BYTES,
          });
          if (
            shouldUseProjectMemoryContextResult({
              status: memoryContext.status,
              sourceCount: memoryContext.sources.length,
            })
          ) {
            autoProjectMemoryPrompt = memoryContext.prompt;
            toast.info(
              `Attached Project Memory context (${memoryContext.sources.length} source(s)).`
            );
          }
        } catch (memoryError) {
          console.error("Automatic Project Memory context failed", memoryError);
        }
      }
      const autoContextPrompt = composeProjectContextPrompt({
        userRequest: message.text,
        memoryPrompt: autoProjectMemoryPrompt,
        indexPrompt: autoProjectIndexPrompt,
      });
      const hasAutoContext = Boolean(autoProjectMemoryPrompt || autoProjectIndexPrompt);
      const messageText =
        mcpCommandPrompt ??
        projectMemoryPrompt ??
        projectIndexPrompt ??
        subagentCommand?.prompt ??
        localCommand?.prompt ??
        localInstruction?.prompt ??
        (hasAutoContext ? autoContextPrompt : null) ??
        message.text;

      const result = await sendMessage(messageText, {
        images: images.length > 0 ? images : undefined,
        resources: resources.length > 0 ? resources : undefined,
        resourceLinks: resourceLinks.length > 0 ? resourceLinks : undefined,
      });
      if (!result.submitted) {
        if (result.error) {
          toast.error(result.error);
        } else if (error) {
          toast.error(error);
        } else {
          toast.info("Prompt is still running. Draft was kept.");
        }
        throw new Error("PROMPT_SUBMIT_REJECTED");
      }
    },
    [
      activeProject,
      activeProjectId,
      chatId,
      effectiveConnStatus,
      error,
      invokeMcpTool,
      localAdeSnapshot?.commands,
      localAdeSnapshot?.mcp.servers,
      localAdeSnapshot?.outputStyles,
      localAdeSnapshot?.projectIndex.indexedAt,
      localAdeSnapshot?.projectMemory.sources,
      localAdeSnapshot?.skills,
      localAdeSnapshot?.subagents,
      promptCapabilities?.embeddedContext,
      sendMessage,
      utils.getFileContent,
      utils.settings.buildProjectMemoryContext,
      utils.settings.searchProjectIndex,
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
    setIsStreamingStatus(effectiveConnStatus === "connected" && isStreaming);
  }, [effectiveConnStatus, isStreaming, setIsStreamingStatus]);

  useEffect(() => {
    if (projectContext?.files) {
      setFiles(projectContext.files);
    }
  }, [projectContext, setFiles]);

  useEffect(() => {
    if (!chatId) {
      return;
    }
    const phaseResolution = resolveSessionBootstrapPhase({
      phase: sessionBootstrapPhase,
      connStatus: effectiveConnStatus,
      hasMessages: messageCount > 0,
    });
    if (phaseResolution !== sessionBootstrapPhase) {
      setSessionBootstrapPhase(phaseResolution);
    }
  }, [
    chatId,
    effectiveConnStatus,
    messageCount,
    sessionBootstrapPhase,
    setSessionBootstrapPhase,
  ]);

  const effectiveBootstrapPhase: SessionBootstrapPhase =
    createSessionMutation.isPending && sessionBootstrapPhase === "idle"
      ? "creating_session"
      : sessionBootstrapPhase;
  const isSessionBootstrapping =
    effectiveBootstrapPhase !== "idle" || createSessionMutation.isPending;
  const shouldShowBootstrapState =
    (!chatId && isSessionBootstrapping) ||
    (Boolean(initialChatId) && isAgentsLoading && !chatId);
  const bootstrapLabel = isSessionBootstrapping
    ? getBootstrapPhaseLabel(effectiveBootstrapPhase)
    : "Loading session...";
  const connectionOverlayLabel =
    createSessionMutation.isPending ||
    effectiveBootstrapPhase === "creating_session"
      ? "Creating session..."
      : effectiveBootstrapPhase === "initializing_agent" ||
          status === "connecting"
        ? "ACP agent initializing..."
        : "Restoring history...";
  const shouldShowPendingConnectionOverlay =
    (effectiveConnStatus === "connecting" || status === "connecting") &&
    messageCount === 0;
  const shouldShowConnectionOverlay =
    createSessionMutation.isPending ||
    effectiveBootstrapPhase === "creating_session" ||
    effectiveBootstrapPhase === "initializing_agent" ||
    effectiveBootstrapPhase === "restoring_history" ||
    shouldShowPendingConnectionOverlay;
  const shouldShowDiagnosticEmptyState =
    Boolean(chatId) &&
    messageCount === 0 &&
    effectiveConnStatus !== "idle" &&
    effectiveConnStatus !== "connecting";
  const diagnosticEmptyStateLabel =
    status === "error"
      ? "Chat stream was interrupted before messages arrived."
      : "Session is running but no messages were synced yet.";
  const permissionDialogVisible =
    permissionDialogOpen || Boolean(activePendingPermission);

  if (shouldShowBootstrapState) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 p-8 text-center">
        <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground" />
        <p className="text-muted-foreground text-sm">{bootstrapLabel}</p>
      </div>
    );
  }

  // Empty state
  if (!chatId) {
    return (
      <>
        <LocalAdeControlCenter
          onStartSession={() => {
            void initChat();
          }}
        />
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
    <div className="relative flex size-full flex-col overflow-hidden">
      <ChatHeader
        agentDisplay={agentDisplay}
        connStatus={displayConnStatus}
        isResuming={isResuming}
        loadNotSupported={resolvedLoadSessionSupported === false}
        onResumeChat={resolvedLoadSessionSupported ? handleResume : undefined}
        onStopChat={handleStopChat}
        projectName={activeProject?.name}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <ChatMessagesPane
          canLoadOlder={hasMoreHistory}
          chatId={chatId}
          isLoadingOlder={isLoadingOlderHistory}
          onLoadOlder={handleLoadOlderHistory}
          status={status}
        />
        {shouldShowConnectionOverlay && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/35 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 shadow-sm">
              <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground" />
              <span className="text-muted-foreground text-xs">
                {connectionOverlayLabel}
              </span>
            </div>
          </div>
        )}
        {shouldShowDiagnosticEmptyState && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[1px]">
            <Empty className="max-w-sm border-none bg-transparent shadow-none">
              <EmptyMedia variant="icon">
                <svg
                  className="size-8"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </EmptyMedia>
              <EmptyContent>
                <EmptyDescription>{diagnosticEmptyStateLabel}</EmptyDescription>
                <Button
                  onClick={() => {
                    void refreshHistory();
                  }}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Reload history
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        )}
      </div>

      <div className="relative border-t bg-background/95 pb-[max(env(safe-area-inset-bottom),0px)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <ChatPlanDockPane chatId={chatId} />
        <ChatInput
          activeTabs={projectContext?.activeTabs}
          availableCommands={availableCommands}
          availableConfigOptions={configOptions}
          availableModels={availableModels}
          availableModes={availableModes}
          connStatus={effectiveConnStatus}
          currentModeId={currentModeId}
          currentModelId={currentModelId}
          isSettingSupervisorMode={isSettingSupervisorMode}
          lastSupervisorDecision={lastSupervisorDecision}
          onCancel={handleCancel}
          onConfigOptionChange={handleSetConfigOption}
          onModeChange={handleSetMode}
          onModelChange={handleSetModel}
          onSetSupervisorMode={handleSetSupervisorMode}
          onSubmit={handleSubmit}
          projectMemorySources={localAdeSnapshot?.projectMemory.sources ?? []}
          projectRules={projectContext?.projectRules}
          status={status}
          supervisor={supervisor}
          supervisorCapable={supervisorCapable}
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
        onSelect={handlePermissionSelect}
        open={permissionDialogVisible}
        request={activePendingPermission}
      />
    </div>
  );
}
