import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  BottomSheet,
  Button,
  Spinner,
  Surface,
  Tabs,
  TextField,
  useThemeColor,
} from "heroui-native";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { AgentIcon } from "@/components/agents/agent-icons";
import { AgentPicker } from "@/components/agents/agent-picker";
import { Container } from "@/components/common/container";
import { useAuthConfigured } from "@/hooks/use-auth-config";
import { useCreateSession } from "@/hooks/use-create-session";
import { useDeleteSession } from "@/hooks/use-delete-session";
import { trpc } from "@/lib/trpc";
import type { SessionInfo } from "@/store/chat-store";
import { useChatStore } from "@/store/chat-store";
import { useProjectStore } from "@/store/project-store";
import type { Agent } from "@/store/settings-store";

type FilterTab = "all" | "active" | "inactive";

function truncateSessionId(id: string | undefined): string {
  if (!id) {
    return "Unknown";
  }
  if (id.length <= 12) {
    return id;
  }
  return `${id.slice(0, 6)}...${id.at(-6)}`;
}

function getSessionTitle(
  name: string | null | undefined,
  sessionId: string
): string {
  const trimmedName = name?.trim();
  if (trimmedName) {
    return trimmedName;
  }
  // Fallback: use truncated session ID as title
  return truncateSessionId(sessionId);
}

function formatTimestamp(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) {
    return "Just now";
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return date.toLocaleDateString();
}

function getSessionAgentType(session: SessionInfo): string | null {
  return (
    session.agentInfo?.title ||
    session.agentInfo?.name ||
    session.agentName ||
    null
  );
}

export default function SessionsScreen() {
  const router = useRouter();
  const themeColorForeground = useThemeColor("foreground");
  const themeColorMuted = useThemeColor("muted");
  const { deleteSession, isDeleting: isDeletingSession } = useDeleteSession();

  const { setActiveChatId, setSessions } = useChatStore();
  const { createSession, isCreating } = useCreateSession();
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
  const agents = agentsData?.agents || [];
  const activeAgentId = agentsData?.activeAgentId;
  const [activeTab, setActiveTab] = useState<FilterTab>("active");
  const [projectForm, setProjectForm] = useState({
    name: "",
    path: "",
    description: "",
    tags: "",
  });
  const [editProjectForm, setEditProjectForm] = useState({
    name: "",
    path: "",
    description: "",
    tags: "",
  });
  const [sessionActionTarget, setSessionActionTarget] = useState<{
    id: string;
    name?: string | null;
    pinned?: boolean;
    archived?: boolean;
  } | null>(null);
  const [sessionNameDraft, setSessionNameDraft] = useState("");

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
    if (!activeProjectId) {
      return null;
    }
    return projects.find((project) => project.id === activeProjectId) ?? null;
  }, [activeProjectId, projects]);

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
    const readOnly = !isActive;
    setActiveChatId(chatId, readOnly);
    // Pass isActive as query param so chat screen knows if it's read-only
    router.push(`/chats/${chatId}?readonly=${readOnly}`);
  };

  const handleDeleteSession = (chatId: string) => {
    void deleteSession(chatId);
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
    const tags = projectForm.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
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

    const tags = editProjectForm.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    updateProject({
      id: editingProject.id,
      name,
      path,
      description: editProjectForm.description.trim() || undefined,
      tags,
    });
  };

  const handleDeleteProject = (projectId: string, projectName: string) => {
    Alert.alert("Delete Project", `Delete project "${projectName}"?`, [
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

  const sessions = sessionsQuery.data ?? [];

  const visibleSessions = activeProjectId
    ? sessions.filter((session) => session.projectId === activeProjectId)
    : [];

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
    if (!activeProjectId && projectsQuery.data.activeProjectId) {
      setActiveProjectId(projectsQuery.data.activeProjectId);
    }
  }, [activeProjectId, projectsQuery.data, setActiveProjectId, setProjects]);

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

  const emptyStateMessage = (() => {
    if (!activeProjectId) {
      return "Select a project to view sessions.";
    }
    if (activeTab === "active") {
      return "No active sessions.\nStart a new chat to begin!";
    }
    if (activeTab === "inactive") {
      return "No inactive sessions.";
    }
    return "No chat sessions yet.\nCreate one to get started!";
  })();

  const renderContent = (() => {
    if (sessionsQuery.isLoading) {
      return (
        <View className="flex-1 items-center justify-center">
          <Spinner size="lg" />
          <Text className="mt-2 text-muted-foreground">
            Loading sessions...
          </Text>
        </View>
      );
    }

    if (filteredSessions.length === 0) {
      return (
        <View className="flex-1 items-center justify-center">
          <Ionicons color="#888" name="chatbubbles-outline" size={64} />
          <Text className="mt-4 text-center text-muted-foreground">
            {emptyStateMessage}
          </Text>
        </View>
      );
    }

    return (
      <FlatList
        contentContainerStyle={{ paddingBottom: 80 }}
        data={filteredSessions}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            onRefresh={() => sessionsQuery.refetch()}
            refreshing={sessionsQuery.isFetching}
          />
        }
        renderItem={({ item }) => {
          const sessionTitle = getSessionTitle(item.name, item.sessionId);
          const sessionAgentType = getSessionAgentType(item);
          return (
            <Pressable
              onPress={() => handleOpenSession(item.id, item.isActive)}
            >
              <Surface className="mb-3 flex-row items-start justify-between rounded-lg p-3">
                <View className="flex-1 pr-3">
                  {/* Title row with status indicator */}
                  <View className="flex-row items-center">
                    <View
                      className={`mr-2 h-2 w-2 rounded-full ${
                        item.isActive ? "bg-green-500" : "bg-zinc-500"
                      }`}
                    />
                    <AgentIcon
                      color={themeColorForeground}
                      secondaryColor={themeColorMuted}
                      size={16}
                      type={sessionAgentType}
                    />
                    <Text
                      className="ml-2 flex-1 font-medium text-base text-foreground"
                      numberOfLines={1}
                    >
                      {sessionTitle}
                    </Text>
                    {item.pinned && (
                      <Ionicons
                        color="#f59e0b"
                        name="pin"
                        size={14}
                        style={{ marginLeft: 6 }}
                      />
                    )}
                  </View>

                  {/* ID and timestamp - subtle */}
                  <Text
                    className="mt-0.5 text-muted-foreground text-xs"
                    numberOfLines={1}
                  >
                    {truncateSessionId(item.sessionId)}
                    {item.lastActiveAt && (
                      <Text className="text-zinc-500">
                        {" • "}
                        {formatTimestamp(item.lastActiveAt)}
                      </Text>
                    )}
                  </Text>

                  {/* Status badges - compact */}
                  <View className="mt-2 flex-row flex-wrap gap-1.5">
                    {!item.isActive && (
                      <View
                        className={`rounded px-2 py-0.5 ${
                          item.loadSessionSupported
                            ? "bg-green-500/20"
                            : "bg-zinc-700"
                        }`}
                      >
                        <Text
                          className={`font-medium text-xs ${
                            item.loadSessionSupported
                              ? "text-green-400"
                              : "text-zinc-300"
                          }`}
                        >
                          {item.loadSessionSupported ? "Resume" : "Read-only"}
                        </Text>
                      </View>
                    )}
                    {item.modeId && (
                      <View className="rounded bg-primary/20 px-2 py-0.5">
                        <Text className="font-medium text-primary text-xs">
                          {item.modeId}
                        </Text>
                      </View>
                    )}
                    {item.archived && (
                      <View className="rounded bg-zinc-700 px-2 py-0.5">
                        <Text className="font-medium text-xs text-zinc-300">
                          Archived
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Menu button only */}
                <Pressable
                  className="p-1"
                  onPress={(event) => {
                    event.stopPropagation();
                    handleOpenSessionActions(item);
                  }}
                >
                  <Ionicons
                    color="#94a3b8"
                    name="ellipsis-vertical"
                    size={20}
                  />
                </Pressable>
              </Surface>
            </Pressable>
          );
        }}
      />
    );
  })();

  return (
    <Container className="flex-1" scroll={false}>
      <View className="flex-1 p-4">
        {error ? (
          <View className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
            <Text className="text-destructive text-sm">{error}</Text>
          </View>
        ) : null}

        {/* Filter Tabs */}
        <Tabs
          onValueChange={(key: string) => setActiveTab(key as FilterTab)}
          value={activeTab}
          variant="pill"
        >
          <Tabs.List className="w-full flex-row">
            <Tabs.Indicator />
            <Tabs.Trigger className="flex-1 items-center" value="active">
              <Tabs.Label className="text-center">
                Active ({activeCount})
              </Tabs.Label>
            </Tabs.Trigger>
            <Tabs.Trigger className="flex-1 items-center" value="inactive">
              <Tabs.Label className="text-center">
                Inactive ({inactiveCount})
              </Tabs.Label>
            </Tabs.Trigger>
            <Tabs.Trigger className="flex-1 items-center" value="all">
              <Tabs.Label className="text-center">
                All ({visibleSessions.length})
              </Tabs.Label>
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs>

        {/* Sessions List */}
        {renderContent}
      </View>

      {/* Create Project Modal */}
      <Modal
        animationType="slide"
        onRequestClose={() => setIsProjectCreateOpen(false)}
        transparent
        visible={isProjectCreateOpen}
      >
        <View className="flex-1 justify-end bg-black/60">
          <View className="max-h-[80%] rounded-t-3xl bg-zinc-900 p-6">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="font-semibold text-lg text-white">
                Create Project
              </Text>
              <Pressable onPress={() => setIsProjectCreateOpen(false)}>
                <Ionicons color="#94a3b8" name="close" size={20} />
              </Pressable>
            </View>

            <ScrollView>
              <TextField>
                <TextField.Label>Name</TextField.Label>
                <TextField.Input
                  autoCapitalize="none"
                  onChangeText={(value) =>
                    setProjectForm((prev) => ({ ...prev, name: value }))
                  }
                  placeholder="My Project"
                  value={projectForm.name}
                />
              </TextField>

              <TextField>
                <TextField.Label>Path</TextField.Label>
                <TextField.Input
                  autoCapitalize="none"
                  onChangeText={(value) =>
                    setProjectForm((prev) => ({ ...prev, path: value }))
                  }
                  placeholder="/absolute/path/to/project"
                  value={projectForm.path}
                />
              </TextField>

              <TextField>
                <TextField.Label>Description</TextField.Label>
                <TextField.Input
                  autoCapitalize="none"
                  onChangeText={(value) =>
                    setProjectForm((prev) => ({
                      ...prev,
                      description: value,
                    }))
                  }
                  placeholder="Optional description"
                  value={projectForm.description}
                />
              </TextField>

              <TextField>
                <TextField.Label>Tags</TextField.Label>
                <TextField.Input
                  autoCapitalize="none"
                  onChangeText={(value) =>
                    setProjectForm((prev) => ({ ...prev, tags: value }))
                  }
                  placeholder="frontend, api, ui"
                  value={projectForm.tags}
                />
              </TextField>
            </ScrollView>

            <View className="pt-2">
              <Button
                isDisabled={createProjectMutation.isPending}
                onPress={handleCreateProject}
              >
                <Button.Label>
                  {createProjectMutation.isPending
                    ? "Creating..."
                    : "Create Project"}
                </Button.Label>
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Project Modal */}
      <Modal
        animationType="slide"
        onRequestClose={() => setEditingProject(null)}
        transparent
        visible={Boolean(editingProject)}
      >
        <View className="flex-1 justify-end bg-black/60">
          <View className="max-h-[80%] rounded-t-3xl bg-zinc-900 p-6">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="font-semibold text-lg text-white">
                Edit Project
              </Text>
              <Pressable onPress={() => setEditingProject(null)}>
                <Ionicons color="#94a3b8" name="close" size={20} />
              </Pressable>
            </View>

            <ScrollView>
              <TextField>
                <TextField.Label>Name</TextField.Label>
                <TextField.Input
                  autoCapitalize="none"
                  onChangeText={(value) =>
                    setEditProjectForm((prev) => ({ ...prev, name: value }))
                  }
                  placeholder="My Project"
                  value={editProjectForm.name}
                />
              </TextField>

              <TextField>
                <TextField.Label>Path</TextField.Label>
                <TextField.Input
                  autoCapitalize="none"
                  onChangeText={(value) =>
                    setEditProjectForm((prev) => ({ ...prev, path: value }))
                  }
                  placeholder="/absolute/path/to/project"
                  value={editProjectForm.path}
                />
              </TextField>

              <TextField>
                <TextField.Label>Description</TextField.Label>
                <TextField.Input
                  autoCapitalize="none"
                  onChangeText={(value) =>
                    setEditProjectForm((prev) => ({
                      ...prev,
                      description: value,
                    }))
                  }
                  placeholder="Optional description"
                  value={editProjectForm.description}
                />
              </TextField>

              <TextField>
                <TextField.Label>Tags</TextField.Label>
                <TextField.Input
                  autoCapitalize="none"
                  onChangeText={(value) =>
                    setEditProjectForm((prev) => ({ ...prev, tags: value }))
                  }
                  placeholder="frontend, api, ui"
                  value={editProjectForm.tags}
                />
              </TextField>
            </ScrollView>

            <View className="pt-2">
              <Button
                isDisabled={updateProjectMutation.isPending}
                onPress={handleUpdateProject}
              >
                <Button.Label>
                  {updateProjectMutation.isPending
                    ? "Saving..."
                    : "Save Changes"}
                </Button.Label>
              </Button>
              {editingProject ? (
                <Pressable
                  className="mt-3 items-center rounded-lg border border-red-500/40 px-4 py-2.5"
                  onPress={() =>
                    handleDeleteProject(editingProject.id, editingProject.name)
                  }
                >
                  <Text className="font-semibold text-red-400">
                    Delete Project
                  </Text>
                </Pressable>
              ) : null}
              <Button onPress={() => setEditingProject(null)} variant="ghost">
                <Button.Label>Cancel</Button.Label>
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* Session Actions Modal */}
      <Modal
        animationType="slide"
        onRequestClose={() => setSessionActionTarget(null)}
        transparent
        visible={Boolean(sessionActionTarget)}
      >
        <View className="flex-1 justify-end bg-black/60">
          <View className="max-h-[70%] rounded-t-3xl bg-zinc-900 p-6">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="font-semibold text-lg text-white">
                Session Options
              </Text>
              <Pressable onPress={() => setSessionActionTarget(null)}>
                <Ionicons color="#94a3b8" name="close" size={20} />
              </Pressable>
            </View>

            <TextField>
              <TextField.Label>Rename Session</TextField.Label>
              <TextField.Input
                autoCapitalize="none"
                onChangeText={setSessionNameDraft}
                placeholder="Session name"
                value={sessionNameDraft}
              />
            </TextField>

            <View className="mt-3">
              <Button
                isDisabled={updateSessionMetaMutation.isPending}
                onPress={handleRenameSession}
              >
                <Button.Label>
                  {updateSessionMetaMutation.isPending
                    ? "Saving..."
                    : "Save Name"}
                </Button.Label>
              </Button>
            </View>

            <View className="mt-4 gap-2">
              <Button
                isDisabled={updateSessionMetaMutation.isPending}
                onPress={handleTogglePinSession}
                variant="ghost"
              >
                <Button.Label>
                  {sessionActionTarget?.pinned
                    ? "Unpin Session"
                    : "Pin Session"}
                </Button.Label>
              </Button>
              <Button
                isDisabled={updateSessionMetaMutation.isPending}
                onPress={handleToggleArchiveSession}
                variant="ghost"
              >
                <Button.Label>
                  {sessionActionTarget?.archived
                    ? "Unarchive Session"
                    : "Archive Session"}
                </Button.Label>
              </Button>
            </View>

            <View className="mt-4 border-zinc-800 border-t pt-4">
              <Button
                isDisabled={
                  updateSessionMetaMutation.isPending || isDeletingSession
                }
                onPress={() => {
                  if (sessionActionTarget) {
                    Alert.alert(
                      "Delete Session",
                      "Are you sure you want to delete this session?",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () => {
                            handleDeleteSession(sessionActionTarget.id);
                            setSessionActionTarget(null);
                          },
                        },
                      ]
                    );
                  }
                }}
                variant="ghost"
              >
                <Button.Label className="text-red-400">
                  Delete Session
                </Button.Label>
              </Button>
            </View>

            <View className="pt-2">
              <Button
                isDisabled={updateSessionMetaMutation.isPending}
                onPress={() => setSessionActionTarget(null)}
                variant="ghost"
              >
                <Button.Label>Close</Button.Label>
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* Select Agent BottomSheet */}
      <BottomSheet
        isOpen={isAgentPickerOpen}
        onOpenChange={setIsAgentPickerOpen}
      >
        <BottomSheet.Portal>
          <BottomSheet.Overlay />
          <BottomSheet.Content
            className="rounded-t-3xl"
            snapPoints={["50%", "70%"]}
          >
            <View className="flex-1 p-6">
              <View className="mb-4 flex-row items-center justify-between">
                <View>
                  <BottomSheet.Title className="font-semibold text-foreground text-lg">
                    Select Agent
                  </BottomSheet.Title>
                  <BottomSheet.Description className="text-muted-foreground text-sm">
                    Choose an agent to start a new session
                  </BottomSheet.Description>
                </View>
                <BottomSheet.Close hitSlop={12}>
                  <Ionicons color="#94a3b8" name="close" size={20} />
                </BottomSheet.Close>
              </View>

              <AgentPicker
                activeAgentId={activeAgentId}
                agents={agents}
                emptyLabel="No agents configured."
                isLoading={isCreating}
                onSelect={handleSelectAgent}
              />
            </View>
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>
    </Container>
  );
}
