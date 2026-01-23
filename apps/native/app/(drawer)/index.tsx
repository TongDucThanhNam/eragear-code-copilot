import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Button, Spinner, Surface, Tabs, TextField } from "heroui-native";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { Container } from "@/components/common/container";
import { trpc } from "@/lib/trpc";
import { useChatStore } from "@/store/chat-store";
import { useProjectStore } from "@/store/project-store";
import { type Agent, useSettingsStore } from "@/store/settings-store";

type FilterTab = "all" | "active" | "inactive";

function truncateSessionId(id: string | undefined): string {
  if (!id) {
    return "Unknown";
  }
  if (id.length <= 12) {
    return id;
  }
  return `${id.slice(0, 6)}...${id.slice(-6)}`;
}

export default function SessionsScreen() {
  const router = useRouter();
  const { setActiveChatId, setSessions, setConnStatus, setModes, setModels } =
    useChatStore();
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setProjects = useProjectStore((s) => s.setProjects);
  const setActiveProjectId = useProjectStore((s) => s.setActiveProjectId);
  const addProject = useProjectStore((s) => s.addProject);
  const isProjectCreateOpen = useProjectStore((s) => s.isProjectCreateOpen);
  const setIsProjectCreateOpen = useProjectStore(
    (s) => s.setIsProjectCreateOpen
  );
  const activeAgentId = useSettingsStore((s) => s.activeAgentId);
  const setActiveAgentId = useSettingsStore((s) => s.setActiveAgentId);
  const getAgents = useSettingsStore((s) => s.getAgents);
  const [error, setError] = useState<string | null>(null);
  const [isAgentPickerOpen, setIsAgentPickerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>("active");
  const [projectForm, setProjectForm] = useState({
    name: "",
    path: "",
    description: "",
    tags: "",
  });

  const sessionsQuery = trpc.getSessions.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  const projectsQuery = trpc.listProjects.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });

  const createSessionMutation = trpc.createSession.useMutation();
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

  const deleteSessionMutation = trpc.deleteSession.useMutation({
    onSuccess: () => {
      sessionsQuery.refetch();
    },
  });

  const activeProject = useMemo(() => {
    if (!activeProjectId) {
      return null;
    }
    return projects.find((project) => project.id === activeProjectId) ?? null;
  }, [activeProjectId, projects]);

  const handleCreateSession = () => {
    setError(null);
    if (!activeProject) {
      setError(
        "Please select a project in the drawer before starting a session."
      );
      return;
    }
    const agents = getAgents();
    if (agents.length === 0) {
      setError("Please configure an ACP agent before starting a session.");
      router.push("/settings");
      return;
    }

    setIsAgentPickerOpen(true);
  };

  const handleSelectAgent = async (agentId: string) => {
    setError(null);
    setIsAgentPickerOpen(false);

    const agents = getAgents();
    const agent = agents.find((a) => a.id === agentId);
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

    setActiveAgentId(agentId);
    setConnStatus("connecting");

    try {
      const data = await createSessionMutation.mutateAsync({
        projectId: activeProject.id,
        command: agent.command,
        args: agent.args,
        env: agent.env,
      });

      setActiveChatId(data.chatId);
      if (data.modes) {
        setModes(data.modes);
      }
      if (data.models) {
        setModels(data.models);
      }
      setConnStatus("connected");

      sessionsQuery.refetch();
      router.push(`/chats/${data.chatId}`);
    } catch (err) {
      const message =
        typeof err === "object" && err && "message" in err
          ? String((err as { message: string }).message)
          : "Failed to create session.";
      setConnStatus("error");
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
    deleteSessionMutation.mutate({ chatId });
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

  const sessions = sessionsQuery.data ?? [];
  const agents = getAgents();

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

  // Reset form when modal closes
  useEffect(() => {
    if (!isProjectCreateOpen) {
      setProjectForm({ name: "", path: "", description: "", tags: "" });
    }
  }, [isProjectCreateOpen]);

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
        data={filteredSessions}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            onRefresh={() => sessionsQuery.refetch()}
            refreshing={sessionsQuery.isFetching}
          />
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => handleOpenSession(item.id, item.isActive)}>
            <Surface className="mb-3 flex-row items-center justify-between rounded-lg p-3">
              <View className="flex-1">
                <View className="flex-row items-center">
                  <Text
                    className="flex-1 font-medium text-foreground"
                    numberOfLines={1}
                  >
                    {truncateSessionId(item.sessionId)}
                  </Text>
                  {!item.isActive && (
                    <View className="ml-2 rounded bg-zinc-700 px-2 py-0.5">
                      <Text className="text-xs text-zinc-300">
                        {item.loadSessionSupported
                          ? "Resume available"
                          : "Read-only"}
                      </Text>
                    </View>
                  )}
                </View>
                <View className="mt-1 flex-row items-center">
                  <View
                    className={`mr-2 h-2 w-2 rounded-full ${
                      item.isActive ? "bg-green-500" : "bg-zinc-500"
                    }`}
                  />
                  <Text className="text-muted-foreground text-sm">
                    {item.isActive ? "Active" : "Inactive"}
                  </Text>
                  {item.modeId && (
                    <Text className="ml-2 text-muted-foreground text-sm">
                      • {item.modeId}
                    </Text>
                  )}
                </View>
              </View>
              <Pressable
                className="p-2"
                onPress={() => handleDeleteSession(item.id)}
              >
                <Ionicons color="#ef4444" name="trash-outline" size={20} />
              </Pressable>
            </Surface>
          </Pressable>
        )}
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

        {/* Active Project Display Card */}
        <Surface className="mb-4 flex-row items-center gap-3 rounded-lg border border-primary p-3">
          <View className="h-10 w-10 items-center justify-center rounded-lg bg-primary/20">
            <Ionicons color="#3b82f6" name="folder" size={20} />
          </View>
          <View className="flex-1">
            <Text className="text-[11px] text-muted-foreground">
              Active Project
            </Text>
            <Text
              className="font-semibold text-[11px] text-foreground"
              numberOfLines={1}
            >
              {activeProject?.name || "No project selected"}
            </Text>
            <Text className="text-muted-foreground text-xs" numberOfLines={1}>
              {activeProject?.path || "Use drawer to select a project"}
            </Text>
          </View>
        </Surface>

        {/* Header with New Chat button */}
        <View className="mb-4 flex-row items-center justify-between">
          <Text className="font-semibold text-foreground text-xl">
            Chat Sessions
          </Text>
          <Button
            isDisabled={createSessionMutation.isPending}
            onPress={handleCreateSession}
          >
            {createSessionMutation.isPending ? (
              <Spinner size="sm" />
            ) : (
              <>
                <Ionicons color="white" name="add" size={20} />
                <Text className="ml-1 text-white">New Chat</Text>
              </>
            )}
          </Button>
        </View>

        {/* Filter Tabs */}
        <Tabs
          onValueChange={(key: string) => setActiveTab(key as FilterTab)}
          value={activeTab}
          variant="pill"
        >
          <Tabs.List>
            <Tabs.ScrollView className="w-full" scrollAlign="center">
              <Tabs.Indicator />
              <Tabs.Trigger value="active">
                <Tabs.Label>Active ({activeCount})</Tabs.Label>
              </Tabs.Trigger>
              <Tabs.Trigger value="inactive">
                <Tabs.Label>Inactive ({inactiveCount})</Tabs.Label>
              </Tabs.Trigger>
              <Tabs.Trigger value="all">
                <Tabs.Label>All ({visibleSessions.length})</Tabs.Label>
              </Tabs.Trigger>
            </Tabs.ScrollView>
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

      {/* Select Agent Modal */}
      <Modal
        animationType="slide"
        onRequestClose={() => setIsAgentPickerOpen(false)}
        transparent
        visible={isAgentPickerOpen}
      >
        <View className="flex-1 justify-end bg-black/60">
          <View className="max-h-[70%] rounded-t-3xl bg-zinc-900 p-6">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="font-semibold text-lg text-white">
                Select Agent
              </Text>
              <Pressable onPress={() => setIsAgentPickerOpen(false)}>
                <Ionicons color="#94a3b8" name="close" size={20} />
              </Pressable>
            </View>

            <ScrollView>
              {agents.length === 0 ? (
                <Text className="text-sm text-zinc-400">
                  No agents configured.
                </Text>
              ) : (
                agents.map((agent: Agent) => (
                  <Pressable
                    className="mb-3 rounded-xl border border-zinc-700 p-4"
                    disabled={createSessionMutation.isPending}
                    key={agent.id}
                    onPress={() => handleSelectAgent(agent.id)}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1">
                        <Text className="font-semibold text-white">
                          {agent.name}
                        </Text>
                        <Text className="mt-1 text-xs text-zinc-400">
                          {agent.type} • {agent.command}
                        </Text>
                      </View>
                      {activeAgentId === agent.id ? (
                        <Ionicons
                          color="#22c55e"
                          name="checkmark-circle"
                          size={18}
                        />
                      ) : null}
                    </View>
                  </Pressable>
                ))
              )}
            </ScrollView>

            <View className="pt-2">
              <Button
                isDisabled={createSessionMutation.isPending}
                onPress={() => setIsAgentPickerOpen(false)}
                variant="ghost"
              >
                <Button.Label>Cancel</Button.Label>
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </Container>
  );
}
