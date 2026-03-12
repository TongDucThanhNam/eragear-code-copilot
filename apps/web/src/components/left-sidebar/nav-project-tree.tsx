"use client";

import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, Folder, Plus } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/components/ui/sidebar";
import { chatDebug } from "@/hooks/use-chat-debug";
import { trpc } from "@/lib/trpc";
import { useChatStatusStore } from "@/store/chat-status-store";
import { useChatStreamStore } from "@/store/chat-stream-store";
import { useProjectStore } from "@/store/project-store";
import { NavProjectTreeDialogs } from "./nav-project-tree/dialogs";
import { useDiscoverSessions } from "./nav-project-tree/use-discover-sessions-state";
import { ProjectRow } from "./nav-project-tree/project-row";
import { SessionList } from "./nav-project-tree/session-list";
import type {
  DiscoverContext,
  DiscoverSessionItem,
  NavProjectTreeProps,
  SessionItem,
} from "./nav-project-tree/types";
import {
  AGENT_RESUME_TEMPLATE_BY_TYPE,
  inferAgentTypeFromSession,
  renderResumeCommand,
  UNKNOWN_PROJECT_ID,
} from "./nav-project-tree/utils";

export function NavProjectTree({ sessions }: NavProjectTreeProps) {
  const navigate = useNavigate();
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    setProjects,
    addProject,
    updateProject,
    removeProject,
  } = useProjectStore();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    path: "",
    description: "",
    tags: "",
  });
  const [isEditProjectOpen, setIsEditProjectOpen] = useState(false);
  const [editProjectId, setEditProjectId] = useState<string | null>(null);
  const [editProjectForm, setEditProjectForm] = useState({
    name: "",
    path: "",
    description: "",
    tags: "",
  });
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selectedSessionForDetails, setSelectedSessionForDetails] =
    useState<SessionItem | null>(null);
  const [deleteProjectTargetId, setDeleteProjectTargetId] = useState<
    string | null
  >(null);
  const [deleteSessionTarget, setDeleteSessionTarget] =
    useState<SessionItem | null>(null);
  const [pendingCreateSessionKey, setPendingCreateSessionKey] = useState<
    string | null
  >(null);

  const {
    discoverContext,
    discoverSessions,
    discoverNextCursor,
    discoverSupported,
    discoverRequiresAuth,
    discoverLoadSessionSupported,
    discoverError,
    discoverIsLoading,
    discoverIsLoadingMore,
    pendingLoadSessionId,
    isDiscoverDialogOpen,
    setDiscoverContext,
    setDiscoverSessions,
    setDiscoverNextCursor,
    setDiscoverSupported,
    setDiscoverRequiresAuth,
    setDiscoverLoadSessionSupported,
    setDiscoverError,
    setDiscoverIsLoading,
    setDiscoverIsLoadingMore,
    setPendingLoadSessionId,
    setIsDiscoverDialogOpen,
    resetDiscoverState: resetDiscoverStateFromHook,
  } = useDiscoverSessions();

  const setSessionBootstrapPhase = useChatStatusStore(
    (state) => state.setSessionBootstrapPhase
  );

  const listQuery = trpc.listProjects.useQuery();
  const agentsQuery = trpc.agents.list.useQuery();
  const agents = agentsQuery.data?.agents || [];
  const agentsById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents]
  );

  useEffect(() => {
    if (listQuery.data) {
      setProjects(listQuery.data.projects);
      if (!activeProjectId && listQuery.data.activeProjectId) {
        setActiveProjectId(listQuery.data.activeProjectId);
      }
    }
  }, [listQuery.data, activeProjectId, setProjects, setActiveProjectId]);

  const setActiveMutation = trpc.setActiveProject.useMutation({
    onError: (err) => {
      toast.error(err.message || "Failed to set active project");
    },
  });
  const trpcUtils = trpc.useUtils();

  const createSessionMutation = trpc.createSession.useMutation({
    onSuccess: () => {
      trpcUtils.getSessions.invalidate();
      trpcUtils.getSessionsPage.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create session");
    },
  });
  const loadAgentSessionMutation = trpc.loadAgentSession.useMutation({
    onSuccess: () => {
      trpcUtils.getSessions.invalidate();
      trpcUtils.getSessionsPage.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to import agent session");
    },
  });
  const isCreatingSession = createSessionMutation.isPending;
  const isLoadingAgentSession = loadAgentSessionMutation.isPending;
  const isSessionBootstrapPending = isCreatingSession || isLoadingAgentSession;
  const updateSessionMetaMutation = trpc.updateSessionMeta.useMutation({
    onSuccess: () => {
      trpcUtils.getSessions.invalidate();
      trpcUtils.getSessionsPage.invalidate();
      toast.success("Session updated");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update session");
    },
  });

  const createProjectMutation = trpc.createProject.useMutation({
    onSuccess: (project) => {
      addProject(project);
      setActiveProjectId(project.id);
      setActiveMutation.mutate({ id: project.id });
      setIsDialogOpen(false);
      setForm({ name: "", path: "", description: "", tags: "" });
      toast.success("Project created");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create project");
    },
  });

  const updateProjectMutation = trpc.updateProject.useMutation({
    onSuccess: (project) => {
      updateProject(project);
      trpcUtils.listProjects.invalidate();
      toast.success("Project updated");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update project");
    },
  });

  const deleteProjectMutation = trpc.deleteProject.useMutation({
    onSuccess: (_result, variables) => {
      removeProject(variables.id);
      trpcUtils.listProjects.invalidate();
      trpcUtils.getSessions.invalidate();
      trpcUtils.getSessionsPage.invalidate();
      toast.success("Project deleted");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete project");
    },
  });

  const deleteSessionMutation = trpc.deleteSession.useMutation({
    onSuccess: (_result, variables) => {
      useChatStreamStore.getState().clearChat(variables.chatId);
      trpcUtils.getSessions.invalidate();
      trpcUtils.getSessionsPage.invalidate();
      toast.success("Session deleted");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete session");
    },
  });

  const projectsSorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aTime = a.lastOpenedAt ?? 0;
      const bTime = b.lastOpenedAt ?? 0;
      return bTime - aTime;
    });
  }, [projects]);

  const sessionsByProject = useMemo(() => {
    const map: Record<string, SessionItem[]> = {};
    for (const session of sessions) {
      const pid = session.projectId || UNKNOWN_PROJECT_ID;
      if (!map[pid]) {
        map[pid] = [];
      }
      map[pid].push(session);
    }
    return map;
  }, [sessions]);
  const unassignedSessions = sessionsByProject[UNKNOWN_PROJECT_ID] || [];

  const deleteProjectTarget = useMemo(() => {
    if (!deleteProjectTargetId) {
      return null;
    }
    return projects.find((item) => item.id === deleteProjectTargetId) || null;
  }, [deleteProjectTargetId, projects]);

  const handleSelectProject = (projectId: string) => {
    setActiveProjectId(projectId);
    setActiveMutation.mutate({ id: projectId });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const tags = form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    createProjectMutation.mutate({
      name: form.name.trim(),
      path: form.path.trim(),
      description: form.description.trim() || undefined,
      tags,
    });
  };

  const handleEditProject = (projectId: string) => {
    const target = projects.find((project) => project.id === projectId);
    if (!target) {
      toast.error("Project not found");
      return;
    }
    setEditProjectId(projectId);
    setEditProjectForm({
      name: target.name,
      path: target.path,
      description: target.description ?? "",
      tags: target.tags.join(", "),
    });
    setIsEditProjectOpen(true);
  };

  const handleEditProjectSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!editProjectId) {
      return;
    }
    const tags = editProjectForm.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    updateProjectMutation.mutate({
      id: editProjectId,
      name: editProjectForm.name.trim(),
      path: editProjectForm.path.trim(),
      description: editProjectForm.description.trim() || undefined,
      tags,
    });
    setIsEditProjectOpen(false);
  };

  const handleDeleteProject = (projectId: string) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      toast.error("Project not found");
      return;
    }
    setDeleteProjectTargetId(projectId);
  };

  const handleRename = (session: SessionItem) => {
    setRenameTargetId(session.id);
    setRenameValue(session.name);
    setIsRenameOpen(true);
  };

  const handleRenameSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!renameTargetId) {
      return;
    }
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast.error("Name is required");
      return;
    }
    updateSessionMetaMutation.mutate({
      chatId: renameTargetId,
      name: trimmed,
    });
    setIsRenameOpen(false);
  };

  const handlePinToggle = (session: SessionItem) => {
    updateSessionMetaMutation.mutate({
      chatId: session.id,
      pinned: !session.pinned,
    });
  };

  const handleArchive = (session: SessionItem) => {
    updateSessionMetaMutation.mutate({
      chatId: session.id,
      archived: true,
    });
  };

  const handleDeleteSession = (session: SessionItem) => {
    setDeleteSessionTarget(session);
  };

  const handleCreateSession = async (params: {
    projectId: string;
    agent: {
      id: string;
      name: string;
    };
  }) => {
    if (isSessionBootstrapPending) {
      return;
    }
    const requestKey = `${params.projectId}:${params.agent.id}`;
    let didNavigate = false;
    setPendingCreateSessionKey(requestKey);
    setSessionBootstrapPhase("creating_session");
    try {
      setActiveProjectId(params.projectId);
      await setActiveMutation.mutateAsync({ id: params.projectId });
      const newSession = await createSessionMutation.mutateAsync({
        projectId: params.projectId,
        agentId: params.agent.id,
      });
      setSessionBootstrapPhase("initializing_agent");
      navigate({
        to: "/",
        search: { chatId: newSession.chatId },
      });
      didNavigate = true;
    } catch {
      // Error is handled by mutation onError callbacks.
    } finally {
      setPendingCreateSessionKey(null);
      if (!didNavigate) {
        setSessionBootstrapPhase("idle");
      }
    }
  };

  const fetchDiscoveredSessions = async (params: {
    context: DiscoverContext;
    cursor?: string;
    append: boolean;
  }) => {
    if (params.append) {
      setDiscoverIsLoadingMore(true);
    } else {
      setDiscoverIsLoading(true);
      setDiscoverError(null);
    }
    try {
      const result = await trpcUtils.discoverAgentSessions.fetch({
        projectId: params.context.projectId,
        agentId: params.context.agentId,
        cursor: params.cursor,
      });
      setDiscoverSupported(result.supported);
      setDiscoverRequiresAuth(result.requiresAuth);
      setDiscoverLoadSessionSupported(result.loadSessionSupported);
      setDiscoverNextCursor(result.nextCursor);
      setDiscoverError(null);
      setDiscoverSessions((prev) => {
        if (!params.append) {
          return result.sessions;
        }
        const merged = new Map(
          prev.map((session) => [session.sessionId, session])
        );
        for (const session of result.sessions) {
          merged.set(session.sessionId, session);
        }
        return Array.from(merged.values());
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to discover agent sessions";
      setDiscoverError(message);
      toast.error(message);
    } finally {
      setDiscoverIsLoading(false);
      setDiscoverIsLoadingMore(false);
    }
  };

  const handleOpenDiscoverDialog = async (params: {
    projectId: string;
    projectName: string;
    agent: { id: string; name: string };
  }) => {
    if (isSessionBootstrapPending) {
      return;
    }
    const nextContext: DiscoverContext = {
      projectId: params.projectId,
      projectName: params.projectName,
      agentId: params.agent.id,
      agentName: params.agent.name,
    };
    resetDiscoverStateFromHook();
    setDiscoverContext(nextContext);
    setIsDiscoverDialogOpen(true);
    await fetchDiscoveredSessions({
      context: nextContext,
      append: false,
    });
  };

  const handleLoadMoreDiscoveredSessions = async () => {
    if (
      !(discoverContext && discoverNextCursor) ||
      discoverIsLoading ||
      discoverIsLoadingMore
    ) {
      return;
    }
    await fetchDiscoveredSessions({
      context: discoverContext,
      cursor: discoverNextCursor,
      append: true,
    });
  };

  const handleLoadDiscoveredSession = async (sessionId: string) => {
    if (!discoverContext || isSessionBootstrapPending) {
      return;
    }
    let didNavigate = false;
    setPendingLoadSessionId(sessionId);
    setSessionBootstrapPhase("creating_session");
    try {
      chatDebug("discover", "loadAgentSession start", {
        projectId: discoverContext.projectId,
        agentId: discoverContext.agentId,
        sourceSessionId: sessionId,
      });
      setActiveProjectId(discoverContext.projectId);
      await setActiveMutation.mutateAsync({ id: discoverContext.projectId });
      const newSession = await loadAgentSessionMutation.mutateAsync({
        projectId: discoverContext.projectId,
        agentId: discoverContext.agentId,
        sessionId,
      });
      chatDebug("discover", "loadAgentSession success", {
        projectId: discoverContext.projectId,
        agentId: discoverContext.agentId,
        sourceSessionId: sessionId,
        createdChatId: newSession.chatId,
        loadedSessionId: newSession.sessionId,
        sessionLoadMethod: newSession.sessionLoadMethod ?? null,
      });
      setSessionBootstrapPhase("initializing_agent");
      setIsDiscoverDialogOpen(false);
      resetDiscoverStateFromHook();
      navigate({
        to: "/",
        search: { chatId: newSession.chatId },
      });
      didNavigate = true;
    } catch {
      chatDebug("discover", "loadAgentSession failed", {
        projectId: discoverContext.projectId,
        agentId: discoverContext.agentId,
        sourceSessionId: sessionId,
      });
      // Error is handled by mutation onError callbacks.
    } finally {
      setPendingLoadSessionId(null);
      if (!didNavigate) {
        setSessionBootstrapPhase("idle");
      }
    }
  };

  const getResumeTemplateForSession = (session: SessionItem) => {
    if (session.agentId) {
      const configuredTemplate = agentsById.get(
        session.agentId
      )?.resumeCommandTemplate;
      if (configuredTemplate) {
        return configuredTemplate;
      }
    }
    const inferredType = inferAgentTypeFromSession(session);
    if (!inferredType) {
      return undefined;
    }
    return AGENT_RESUME_TEMPLATE_BY_TYPE[inferredType];
  };

  const handleCopyResumeCommand = async (session: SessionItem) => {
    if (!session.sessionId) {
      toast.error("This session does not have an agent session ID yet.");
      return;
    }
    const template = getResumeTemplateForSession(session);
    if (!template) {
      toast.error("No resume command template configured for this agent.");
      return;
    }
    const command = renderResumeCommand(template, session.sessionId);
    try {
      await navigator.clipboard.writeText(command);
      toast.success("Agent resume command copied.");
    } catch {
      toast.error("Failed to copy agent resume command.");
    }
  };

  const handleConfirmDeleteProject = () => {
    if (!deleteProjectTargetId) {
      return;
    }
    if (activeProjectId === deleteProjectTargetId) {
      setActiveProjectId(null);
      setActiveMutation.mutate({ id: null });
    }
    deleteProjectMutation.mutate({ id: deleteProjectTargetId });
    setDeleteProjectTargetId(null);
  };

  const handleConfirmDeleteSession = () => {
    if (!deleteSessionTarget) {
      return;
    }
    deleteSessionMutation.mutate({
      chatId: deleteSessionTarget.id,
    });
    setDeleteSessionTarget(null);
  };

  const handleRefreshDiscoverSessions = () => {
    if (!discoverContext) {
      return;
    }
    void fetchDiscoveredSessions({
      context: discoverContext,
      append: false,
    });
  };

  const isLoading = listQuery.isLoading;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Projects</SidebarGroupLabel>
      <SidebarGroupAction
        onClick={() => setIsDialogOpen(true)}
        title="Add project"
      >
        <Plus className="size-4" />
      </SidebarGroupAction>

      <SidebarMenu>
        {isLoading && (
          <SidebarMenuItem>
            <SidebarMenuButton disabled>Loading projects...</SidebarMenuButton>
          </SidebarMenuItem>
        )}

        {!isLoading && projectsSorted.length === 0 && (
          <SidebarMenuItem>
            <SidebarMenuButton disabled>No projects yet</SidebarMenuButton>
          </SidebarMenuItem>
        )}

        {projectsSorted.map((project) => {
          const projectSessions = sessionsByProject[project.id] || [];
          const isActive = activeProjectId === project.id;

          return (
            <ProjectRow
              agents={agents.map((agent) => ({
                id: agent.id,
                name: agent.name,
              }))}
              discoverContext={discoverContext}
              discoverIsLoading={discoverIsLoading}
              isActive={isActive}
              isCreatingSession={isCreatingSession}
              isSessionBootstrapPending={isSessionBootstrapPending}
              key={project.id}
              onCreateSession={handleCreateSession}
              onDeleteProject={handleDeleteProject}
              onEditProject={handleEditProject}
              onOpenDiscoverDialog={handleOpenDiscoverDialog}
              onSelectProject={handleSelectProject}
              pendingCreateSessionKey={pendingCreateSessionKey}
              project={{ id: project.id, name: project.name }}
              projectSessions={projectSessions}
              sessionActions={{
                onArchive: handleArchive,
                onCopyResumeCommand: handleCopyResumeCommand,
                onDelete: handleDeleteSession,
                onPinToggle: handlePinToggle,
                onRename: handleRename,
                onViewDetails: setSelectedSessionForDetails,
              }}
            />
          );
        })}

        {unassignedSessions.length > 0 && (
          <Collapsible asChild className="group/collapsible" defaultOpen>
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton tooltip="Unassigned Sessions">
                  <ChevronRight className="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  <Folder className="text-muted-foreground/80" />
                  <span>Unassigned Sessions</span>
                  <Badge className="ml-auto" variant="secondary">
                    {unassignedSessions.length}
                  </Badge>
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  <SessionList
                    onArchive={handleArchive}
                    onCopyResumeCommand={handleCopyResumeCommand}
                    onDelete={handleDeleteSession}
                    onPinToggle={handlePinToggle}
                    onRename={handleRename}
                    onViewDetails={setSelectedSessionForDetails}
                    sessions={unassignedSessions}
                  />
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        )}
      </SidebarMenu>

      <NavProjectTreeDialogs
        deleteProjectTargetId={deleteProjectTargetId}
        deleteProjectTargetName={deleteProjectTarget?.name}
        deleteSessionTarget={deleteSessionTarget}
        discoverContext={discoverContext}
        discoverError={discoverError}
        discoverIsLoading={discoverIsLoading}
        discoverIsLoadingMore={discoverIsLoadingMore}
        discoverLoadSessionSupported={discoverLoadSessionSupported}
        discoverNextCursor={discoverNextCursor}
        discoverRequiresAuth={discoverRequiresAuth}
        discoverSessions={discoverSessions}
        discoverSupported={discoverSupported}
        editProjectForm={editProjectForm}
        form={form}
        isCreateProjectPending={createProjectMutation.isPending}
        isDialogOpen={isDialogOpen}
        isDiscoverDialogOpen={isDiscoverDialogOpen}
        isEditProjectOpen={isEditProjectOpen}
        isRenameOpen={isRenameOpen}
        isSessionBootstrapPending={isSessionBootstrapPending}
        isUpdateProjectPending={updateProjectMutation.isPending}
        onConfirmDeleteProject={handleConfirmDeleteProject}
        onConfirmDeleteSession={handleConfirmDeleteSession}
        onCreateProjectSubmit={handleSubmit}
        onEditProjectSubmit={handleEditProjectSubmit}
        onLoadDiscoveredSession={handleLoadDiscoveredSession}
        onLoadMoreDiscoveredSessions={() => {
          handleLoadMoreDiscoveredSessions();
        }}
        onRefreshDiscoverSessions={handleRefreshDiscoverSessions}
        onRenameSubmit={handleRenameSubmit}
        pendingLoadSessionId={pendingLoadSessionId}
        renameValue={renameValue}
        resetDiscoverState={resetDiscoverStateFromHook}
        selectedSessionForDetails={selectedSessionForDetails}
        setDeleteProjectTargetId={setDeleteProjectTargetId}
        setDeleteSessionTarget={setDeleteSessionTarget}
        setEditProjectForm={setEditProjectForm}
        setForm={setForm}
        setIsDialogOpen={setIsDialogOpen}
        setIsDiscoverDialogOpen={setIsDiscoverDialogOpen}
        setIsEditProjectOpen={setIsEditProjectOpen}
        setIsRenameOpen={setIsRenameOpen}
        setRenameValue={setRenameValue}
        setSelectedSessionForDetails={setSelectedSessionForDetails}
      />
    </SidebarGroup>
  );
}
