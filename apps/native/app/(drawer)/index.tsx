import { DrawerActions } from "@react-navigation/native";
import { useNavigation, useRouter } from "expo-router";
import { Alert } from "heroui-native";
import { useEffect, useMemo, useState } from "react";
import { Alert as NativeAlert, View } from "react-native";
import { Container } from "@/components/common/container";
import { AgentPickerSheet } from "@/components/sessions/agent-picker-sheet";
import { DiscoverSessionsDialog } from "@/components/sessions/discover-sessions-dialog";
import { ProjectFormDialog } from "@/components/sessions/project-form-dialog";
import { SessionActionsDialog } from "@/components/sessions/session-actions-dialog";
import { SessionFilterTabs } from "@/components/sessions/session-filter-tabs";
import { SessionFloatingActions } from "@/components/sessions/session-floating-actions";
import { SessionList } from "@/components/sessions/session-list";
import { parseProjectTags } from "@/components/sessions/session-utils";
import { SessionsHeader } from "@/components/sessions/sessions-header";
import type {
  DiscoveredSessionItem,
  FilterTab,
  ListedSession,
  ProjectFormState,
  SessionActionTarget,
} from "@/components/sessions/types";
import { useAuthConfigured } from "@/hooks/use-auth-config";
import { useCreateSession } from "@/hooks/use-create-session";
import { useDeleteSession } from "@/hooks/use-delete-session";
import { buildChatRoute } from "@/lib/session-access";
import { trpc } from "@/lib/trpc";
import { useChatStore } from "@/store/chat-store";
import { useProjectStore } from "@/store/project-store";
import type { Agent } from "@/store/settings-store";

export default function SessionsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { deleteSession, isDeleting: isDeletingSession } = useDeleteSession();

  const { setActiveChatId, setSessions } = useChatStore();
  const { createSession, loadAgentSession, isCreating } = useCreateSession();
  const trpcUtils = trpc.useUtils();
  const {
    projects,
    activeProjectId,
    setProjects,
    setActiveProjectId,
    addProject,
    updateProject,
    updateProjectLocal,
    editingProject,
    setEditingProject,
    isProjectCreateOpen,
    setIsProjectCreateOpen,
    setProjectMutations,
    removeProject,
    removeProjectLocal,
    isAgentPickerOpen,
    setIsAgentPickerOpen,
  } = useProjectStore();
  const [error, setError] = useState<string | null>(null);
  const isConfigured = useAuthConfigured();

  // Fetch agents from server (managed by server now)
  const { data: agentsData } = trpc.agents.list.useQuery(undefined, {
    enabled: isConfigured,
  });
  const agents = (agentsData?.agents ?? []) as Agent[];
  const activeAgentId = agentsData?.activeAgentId;
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [projectForm, setProjectForm] = useState<ProjectFormState>({
    name: "",
    path: "",
    description: "",
    tags: "",
  });
  const [editProjectForm, setEditProjectForm] = useState<ProjectFormState>({
    name: "",
    path: "",
    description: "",
    tags: "",
  });
  const [sessionActionTarget, setSessionActionTarget] =
    useState<SessionActionTarget | null>(null);
  const [sessionNameDraft, setSessionNameDraft] = useState("");
  const [isDiscoverModalOpen, setIsDiscoverModalOpen] = useState(false);
  const [discoverAgentId, setDiscoverAgentId] = useState<string | null>(null);
  const [discoverSessions, setDiscoverSessions] = useState<
    DiscoveredSessionItem[]
  >([]);
  const [discoverNextCursor, setDiscoverNextCursor] = useState<string | null>(
    null
  );
  const [discoverSupported, setDiscoverSupported] = useState(false);
  const [discoverRequiresAuth, setDiscoverRequiresAuth] = useState(false);
  const [discoverLoadSessionSupported, setDiscoverLoadSessionSupported] =
    useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverIsLoading, setDiscoverIsLoading] = useState(false);
  const [discoverIsLoadingMore, setDiscoverIsLoadingMore] = useState(false);
  const [pendingDiscoverLoadSessionId, setPendingDiscoverLoadSessionId] =
    useState<string | null>(null);

  const sessionsQuery = trpc.getSessions.useQuery(undefined, {
    refetchOnWindowFocus: true,
    enabled: isConfigured,
  });
  const projectsQuery = trpc.listProjects.useQuery(undefined, {
    refetchOnWindowFocus: true,
    enabled: isConfigured,
  });

  const setActiveProjectMutation = trpc.setActiveProject.useMutation({
    onError: (err) => {
      const message =
        typeof err?.message === "string"
          ? err.message
          : "Failed to set active project.";
      setError(message);
    },
  });
  const createProjectMutation = trpc.createProject.useMutation({
    onSuccess: (project) => {
      addProject(project);
      setActiveProjectId(project.id);
      setActiveProjectMutation.mutate({ id: project.id });
      setProjectForm({ name: "", path: "", description: "", tags: "" });
      setIsProjectCreateOpen(false);
    },
    onError: (err) => {
      const message =
        typeof err?.message === "string"
          ? err.message
          : "Failed to create project.";
      setError(message);
    },
  });
  const updateProjectMutation = trpc.updateProject.useMutation({
    onSuccess: (project) => {
      updateProjectLocal(project);
      projectsQuery.refetch();
      setEditingProject(null);
    },
    onError: (err) => {
      const message =
        typeof err?.message === "string"
          ? err.message
          : "Failed to update project.";
      setError(message);
    },
  });
  const deleteProjectMutation = trpc.deleteProject.useMutation({
    onSuccess: (_data, variables) => {
      removeProjectLocal(variables.id);
      if (activeProjectId === variables.id) {
        setActiveProjectId(null);
        setActiveProjectMutation.mutate({ id: null });
      }
      projectsQuery.refetch();
      if (editingProject?.id === variables.id) {
        setEditingProject(null);
      }
    },
    onError: (err) => {
      const message =
        typeof err?.message === "string"
          ? err.message
          : "Failed to delete project.";
      setError(message);
    },
  });

  const updateSessionMetaMutation = trpc.updateSessionMeta.useMutation({
    onSuccess: () => {
      sessionsQuery.refetch();
      setSessionActionTarget(null);
    },
    onError: (err) => {
      const message =
        typeof err?.message === "string"
          ? err.message
          : "Failed to update session.";
      setError(message);
    },
  });

  const projectMutationHandlers = useMemo(
    () => ({
      updateProject: (input: {
        id: string;
        name?: string;
        path?: string;
        description?: string | null;
        tags?: string[];
        favorite?: boolean;
      }) => updateProjectMutation.mutate(input),
      deleteProject: (input: { id: string }) =>
        deleteProjectMutation.mutate(input),
    }),
    [deleteProjectMutation.mutate, updateProjectMutation.mutate]
  );

  const activeProject = useMemo(() => {
    const queryActiveProjectId = projectsQuery.data?.activeProjectId ?? null;
    const queryProjects = (projectsQuery.data?.projects ??
      []) as typeof projects;
    const resolvedActiveProjectId =
      activeProjectId ?? (projects.length === 0 ? queryActiveProjectId : null);
    if (!resolvedActiveProjectId) {
      return null;
    }
    return (
      projects.find((project) => project.id === resolvedActiveProjectId) ??
      queryProjects.find(
        (project) => project.id === resolvedActiveProjectId
      ) ??
      null
    );
  }, [
    activeProjectId,
    projects,
    projectsQuery.data?.activeProjectId,
    projectsQuery.data?.projects,
  ]);

  const handleSelectAgent = async (agentId: string) => {
    setError(null);
    setIsAgentPickerOpen(false);

    const agent = agents.find((a: Agent) => a.id === agentId);
    if (!agent) {
      setError("Selected agent not found. Please configure an ACP agent.");
      router.push("/settings");
      return;
    }
    if (!activeProject) {
      setError(
        "Please select a project in the drawer before starting a session."
      );
      return;
    }

    try {
      const { chatId } = await createSession(agent, activeProject.id);
      router.push(`/chats/${chatId}`);
    } catch (err) {
      // Error already set in store by hook, also set local error for UI display
      const message =
        typeof err === "object" && err && "message" in err
          ? String((err as { message: string }).message)
          : "Failed to create session.";
      setError(message);
    }
  };

  const handleOpenSession = (chatId: string, isActive?: boolean) => {
    const readOnly = isActive !== true;
    setActiveChatId(chatId, readOnly);
    router.push(buildChatRoute(chatId, isActive));
  };

  const handleDeleteSession = (chatId: string) => {
    deleteSession(chatId);
  };

  const resetDiscoverState = () => {
    setDiscoverSessions([]);
    setDiscoverNextCursor(null);
    setDiscoverSupported(false);
    setDiscoverRequiresAuth(false);
    setDiscoverLoadSessionSupported(false);
    setDiscoverError(null);
    setDiscoverIsLoading(false);
    setDiscoverIsLoadingMore(false);
    setPendingDiscoverLoadSessionId(null);
  };

  const runDiscoverSessions = async (params: {
    agentId: string;
    cursor?: string;
    append: boolean;
  }) => {
    if (!activeProject) {
      setDiscoverError("Please select a project before discovering sessions.");
      return;
    }

    if (params.append) {
      setDiscoverIsLoadingMore(true);
    } else {
      setDiscoverIsLoading(true);
      setDiscoverError(null);
    }

    try {
      const result = await trpcUtils.discoverAgentSessions.fetch({
        projectId: activeProject.id,
        agentId: params.agentId,
        cursor: params.cursor,
      });
      setDiscoverSupported(result.supported);
      setDiscoverRequiresAuth(result.requiresAuth);
      setDiscoverLoadSessionSupported(result.loadSessionSupported);
      setDiscoverNextCursor(result.nextCursor);
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
    } catch (err) {
      const message =
        typeof err === "object" && err && "message" in err
          ? String((err as { message: string }).message)
          : "Failed to discover agent sessions.";
      setDiscoverError(message);
    } finally {
      setDiscoverIsLoading(false);
      setDiscoverIsLoadingMore(false);
    }
  };

  const handleOpenDiscoverModal = () => {
    if (!activeProject) {
      setError("Please select a project before discovering sessions.");
      return;
    }
    if (agents.length === 0) {
      setError("No agents configured. Please configure an ACP agent first.");
      return;
    }
    const initialAgentId = activeAgentId ?? agents[0]?.id ?? null;
    if (!initialAgentId) {
      setError("No agent available for session discovery.");
      return;
    }
    setError(null);
    resetDiscoverState();
    setDiscoverAgentId(initialAgentId);
    setIsDiscoverModalOpen(true);
    runDiscoverSessions({
      agentId: initialAgentId,
      append: false,
    });
  };

  const handleSelectDiscoverAgent = (agentId: string) => {
    setDiscoverAgentId(agentId);
    resetDiscoverState();
    runDiscoverSessions({
      agentId,
      append: false,
    });
  };

  const handleLoadMoreDiscoveredSessions = () => {
    if (
      !(discoverAgentId && discoverNextCursor) ||
      discoverIsLoading ||
      discoverIsLoadingMore
    ) {
      return;
    }
    runDiscoverSessions({
      agentId: discoverAgentId,
      cursor: discoverNextCursor,
      append: true,
    });
  };

  const handleLoadDiscoveredSession = async (sessionId: string) => {
    if (!(activeProject && discoverAgentId) || isCreating) {
      return;
    }

    const selectedAgent = agents.find(
      (agent: Agent) => agent.id === discoverAgentId
    );
    if (!selectedAgent) {
      setDiscoverError("Selected agent was not found.");
      return;
    }

    setPendingDiscoverLoadSessionId(sessionId);
    try {
      const { chatId } = await loadAgentSession({
        agent: selectedAgent,
        projectId: activeProject.id,
        sessionId,
      });
      setIsDiscoverModalOpen(false);
      setDiscoverAgentId(null);
      resetDiscoverState();
      router.push(`/chats/${chatId}`);
    } catch (err) {
      const message =
        typeof err === "object" && err && "message" in err
          ? String((err as { message: string }).message)
          : "Failed to load selected session.";
      setDiscoverError(message);
    } finally {
      setPendingDiscoverLoadSessionId(null);
    }
  };

  const handleCreateProject = () => {
    setError(null);
    const name = projectForm.name.trim();
    const path = projectForm.path.trim();
    const hasName = name.length > 0;
    const hasPath = path.length > 0;

    if (!(hasName && hasPath)) {
      setError("Project name and path are required.");
      return;
    }
    const tags = parseProjectTags(projectForm.tags);
    createProjectMutation.mutate({
      name,
      path,
      description: projectForm.description.trim() || undefined,
      tags,
    });
  };

  const handleUpdateProject = () => {
    if (!editingProject) {
      return;
    }
    setError(null);
    const name = editProjectForm.name.trim();
    const path = editProjectForm.path.trim();
    const hasName = name.length > 0;
    const hasPath = path.length > 0;

    if (!(hasName && hasPath)) {
      setError("Project name and path are required.");
      return;
    }

    const tags = parseProjectTags(editProjectForm.tags);

    updateProject({
      id: editingProject.id,
      name,
      path,
      description: editProjectForm.description.trim() || undefined,
      tags,
    });
  };

  const handleDeleteProject = (projectId: string, projectName: string) => {
    NativeAlert.alert("Delete Project", `Delete project "${projectName}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeProject(projectId),
      },
    ]);
  };

  const handleOpenSessionActions = (session: {
    id: string;
    name?: string | null;
    pinned?: boolean;
    archived?: boolean;
  }) => {
    setSessionActionTarget({
      id: session.id,
      name: session.name ?? "",
      pinned: session.pinned ?? false,
      archived: session.archived ?? false,
    });
    setSessionNameDraft(session.name ?? "");
  };

  const handleRenameSession = () => {
    if (!sessionActionTarget) {
      return;
    }
    const trimmed = sessionNameDraft.trim();
    updateSessionMetaMutation.mutate({
      chatId: sessionActionTarget.id,
      name: trimmed.length > 0 ? trimmed : null,
    });
  };

  const handleTogglePinSession = () => {
    if (!sessionActionTarget) {
      return;
    }
    updateSessionMetaMutation.mutate({
      chatId: sessionActionTarget.id,
      pinned: !sessionActionTarget.pinned,
    });
  };

  const handleToggleArchiveSession = () => {
    if (!sessionActionTarget) {
      return;
    }
    updateSessionMetaMutation.mutate({
      chatId: sessionActionTarget.id,
      archived: !sessionActionTarget.archived,
    });
  };

  const sessions = (sessionsQuery.data ?? []) as ListedSession[];

  const visibleSessions = activeProjectId
    ? sessions.filter((session) => session.projectId === activeProjectId)
    : sessions;

  // Filter sessions based on active tab
  const filteredSessions = useMemo(() => {
    if (activeTab === "all") {
      return visibleSessions;
    }
    if (activeTab === "active") {
      return visibleSessions.filter((s) => s.isActive);
    }
    return visibleSessions.filter((s) => !s.isActive); // inactive
  }, [visibleSessions, activeTab]);

  useEffect(() => {
    if (!sessionsQuery.data) {
      return;
    }
    setSessions(sessionsQuery.data);
  }, [sessionsQuery.data, setSessions]);

  useEffect(() => {
    if (!projectsQuery.data) {
      return;
    }
    setProjects(projectsQuery.data.projects);
    if (
      projects.length === 0 &&
      !activeProjectId &&
      projectsQuery.data.activeProjectId
    ) {
      setActiveProjectId(projectsQuery.data.activeProjectId);
    }
  }, [
    activeProjectId,
    projects.length,
    projectsQuery.data,
    setActiveProjectId,
    setProjects,
  ]);

  useEffect(() => {
    setProjectMutations(projectMutationHandlers);
  }, [projectMutationHandlers, setProjectMutations]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isProjectCreateOpen) {
      setProjectForm({ name: "", path: "", description: "", tags: "" });
    }
  }, [isProjectCreateOpen]);

  useEffect(() => {
    if (!editingProject) {
      setEditProjectForm({ name: "", path: "", description: "", tags: "" });
      return;
    }
    setEditProjectForm({
      name: editingProject.name,
      path: editingProject.path,
      description: editingProject.description ?? "",
      tags: editingProject.tags?.join(", ") ?? "",
    });
  }, [editingProject]);

  const activeCount = visibleSessions.filter((s) => s.isActive).length;
  const inactiveCount = visibleSessions.filter((s) => !s.isActive).length;
  const allCount = visibleSessions.length;

  const emptyStateMessage = (() => {
    if (activeTab === "active") {
      return "No active sessions.\nStart a new chat to begin!";
    }
    if (activeTab === "inactive") {
      return "No inactive sessions.";
    }
    return "No chat sessions yet.\nCreate one to get started!";
  })();

  const screenTitle = activeProject?.name ?? "All Tasks";
  const canCreateSession = Boolean(activeProject) && agents.length > 0;
  const projectNamesById = useMemo(
    () =>
      Object.fromEntries(projects.map((project) => [project.id, project.name])),
    [projects]
  );

  return (
    <Container className="flex-1" scroll={false}>
      <View className="flex-1 bg-background">
        <SessionsHeader
          canCreateSession={canCreateSession}
          isCreating={isCreating}
          title={screenTitle}
          onCreateSession={() => setIsAgentPickerOpen(true)}
          onOpenDrawer={() => navigation.dispatch(DrawerActions.openDrawer())}
        />

        {error ? (
          <Alert className="mx-6 mb-3" status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Unable to continue</Alert.Title>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        <SessionFilterTabs
          activeCount={activeCount}
          activeTab={activeTab}
          allCount={allCount}
          inactiveCount={inactiveCount}
          onChangeTab={setActiveTab}
        />

        <SessionList
          activeProjectName={activeProject?.name}
          emptyStateMessage={emptyStateMessage}
          isFetching={sessionsQuery.isFetching}
          isLoading={sessionsQuery.isLoading}
          projectNamesById={projectNamesById}
          sessions={filteredSessions}
          onOpenSession={handleOpenSession}
          onOpenSessionActions={handleOpenSessionActions}
          onRefresh={() => sessionsQuery.refetch()}
        />

        <SessionFloatingActions
          canCreateSession={canCreateSession}
          isCreating={isCreating}
          onCreateSession={() => setIsAgentPickerOpen(true)}
          onDiscoverSessions={handleOpenDiscoverModal}
        />
      </View>

      <ProjectFormDialog
        form={projectForm}
        isOpen={isProjectCreateOpen}
        isSubmitting={createProjectMutation.isPending}
        mode="create"
        onChangeForm={setProjectForm}
        onOpenChange={(open) => !open && setIsProjectCreateOpen(false)}
        onSubmit={handleCreateProject}
      />

      <ProjectFormDialog
        form={editProjectForm}
        isOpen={Boolean(editingProject)}
        isSubmitting={updateProjectMutation.isPending}
        mode="edit"
        showDelete={Boolean(editingProject)}
        onChangeForm={setEditProjectForm}
        onDelete={() => {
          if (editingProject) {
            handleDeleteProject(editingProject.id, editingProject.name);
          }
        }}
        onOpenChange={(open) => !open && setEditingProject(null)}
        onSubmit={handleUpdateProject}
      />

      <DiscoverSessionsDialog
        activeAgentId={discoverAgentId}
        activeProjectName={activeProject?.name}
        agents={agents}
        error={discoverError}
        isCreating={isCreating}
        isLoading={discoverIsLoading}
        isLoadingMore={discoverIsLoadingMore}
        isOpen={isDiscoverModalOpen}
        loadSessionSupported={discoverLoadSessionSupported}
        nextCursor={discoverNextCursor}
        pendingLoadSessionId={pendingDiscoverLoadSessionId}
        requiresAuth={discoverRequiresAuth}
        sessions={discoverSessions}
        supported={discoverSupported}
        onLoadMore={handleLoadMoreDiscoveredSessions}
        onLoadSession={handleLoadDiscoveredSession}
        onOpenChange={(open) => {
          if (!open) {
            setIsDiscoverModalOpen(false);
            setDiscoverAgentId(null);
            resetDiscoverState();
          }
        }}
        onRefresh={() => {
          if (discoverAgentId) {
            runDiscoverSessions({
              agentId: discoverAgentId,
              append: false,
            });
          }
        }}
        onSelectAgent={handleSelectDiscoverAgent}
      />

      <SessionActionsDialog
        isDeleting={isDeletingSession}
        isSaving={updateSessionMetaMutation.isPending}
        nameDraft={sessionNameDraft}
        target={sessionActionTarget}
        onChangeNameDraft={setSessionNameDraft}
        onDeleteConfirmed={() => {
          if (sessionActionTarget) {
            handleDeleteSession(sessionActionTarget.id);
            setSessionActionTarget(null);
          }
        }}
        onOpenChange={(open) => !open && setSessionActionTarget(null)}
        onRename={handleRenameSession}
        onToggleArchive={handleToggleArchiveSession}
        onTogglePin={handleTogglePinSession}
      />

      <AgentPickerSheet
        activeAgentId={activeAgentId}
        agents={agents}
        isLoading={isCreating}
        isOpen={isAgentPickerOpen}
        onOpenChange={setIsAgentPickerOpen}
        onSelectAgent={handleSelectAgent}
      />
    </Container>
  );
}
