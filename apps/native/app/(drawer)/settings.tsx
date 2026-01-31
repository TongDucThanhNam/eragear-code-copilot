import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Button,
  Card,
  Surface,
  TextField,
  useThemeColor,
  useToast,
} from "heroui-native";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { withUniwind } from "uniwind";

import { Container } from "@/components/common/container";
import { useAuthConfigured } from "@/hooks/use-auth-config";
import { trpc } from "@/lib/trpc";
import { useAuthStore } from "@/store/auth-store";

// Wrap Ionicons with Uniwind for className support
const StyledIcon = withUniwind(Ionicons);

const AGENT_TYPES = ["opencode", "codex", "claude", "gemini", "other"] as const;

export default function SettingsScreen() {
  const router = useRouter();
  const themeColorSuccess = useThemeColor("success");
  const themeColorMuted = useThemeColor("muted");
  const themeColorDanger = useThemeColor("danger");

  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { apiKey, serverUrl, setApiKey } = useAuthStore();
  const isConfigured = useAuthConfigured();

  // Agent state
  const [editingId, setEditingId] = useState<string | null>(null);
  const emptyForm = {
    name: "",
    type: "opencode" as "claude" | "codex" | "opencode" | "gemini" | "other",
    command: "",
    args: "acp",
    env: "{}",
  };
  const [formData, setFormData] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const handleClearApiKey = () => {
    setApiKey(null);
    toast.show("Disconnected");
    router.replace("/login");
  };

  const { data: agentsData, isLoading: isLoadingAgents } =
    trpc.agents.list.useQuery(undefined, {
      retry: false,
      enabled: isConfigured,
    });

  const createAgent = trpc.agents.create.useMutation({
    onSuccess: () => {
      utils.agents.list.invalidate();
      toast.show("Agent created");
      setEditingId(null);
      setFormData(emptyForm);
    },
    onError: (err) => setError(err.message),
  });

  const updateAgent = trpc.agents.update.useMutation({
    onSuccess: () => {
      utils.agents.list.invalidate();
      toast.show("Agent updated");
      setEditingId(null);
      setFormData(emptyForm);
    },
    onError: (err) => setError(err.message),
  });

  const deleteAgent = trpc.agents.delete.useMutation({
    onSuccess: () => {
      utils.agents.list.invalidate();
      toast.show("Agent deleted");
    },
    onError: (err) => toast.show(err.message),
  });

  const setActiveAgent = trpc.agents.setActive.useMutation({
    onSuccess: () => {
      utils.agents.list.invalidate();
      toast.show("Active agent updated");
    },
  });

  const handleEdit = (agent: any) => {
    setEditingId(agent.id);
    setFormData({
      name: agent.name,
      type: agent.type,
      command: agent.command,
      args: (agent.args || []).join(" "),
      env: JSON.stringify(agent.env || {}, null, 2),
    });
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert("Delete Agent", `Delete agent "${name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteAgent.mutate({ id }),
      },
    ]);
  };

  const handleSave = () => {
    setError(null);
    try {
      const envParsed =
        formData.env.trim().length === 0 ? {} : JSON.parse(formData.env);
      const argsParsed = formData.args.split(" ").filter(Boolean);

      if (editingId) {
        updateAgent.mutate({
          id: editingId,
          name: formData.name,
          type: formData.type,
          command: formData.command.trim(),
          args: argsParsed,
          env: envParsed,
        });
      } else {
        createAgent.mutate({
          name: formData.name,
          type: formData.type,
          command: formData.command.trim(),
          args: argsParsed,
          env: envParsed,
        });
      }
    } catch (err) {
      console.warn("Invalid env JSON", err);
      setError("Invalid ENV JSON. Please fix and save again.");
    }
  };

  const handleAddNew = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setError(null);
  };

  const agents = agentsData?.agents || [];
  const activeAgentId = agentsData?.activeAgentId;

  // Check if authenticated
  const isAuthenticated = isConfigured;

  return (
    <Container className="flex-1">
      <View className="flex-1 gap-4 p-4">
        {/* Server Info Section */}
        <Surface className="rounded-lg p-4" variant="secondary">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-base text-foreground">
              Server Connection
            </Text>
            {isConfigured && (
              <View className="flex-row items-center gap-1">
                <View className="h-2 w-2 rounded-full bg-success" />
                <Text className="text-success text-xs">Connected</Text>
              </View>
            )}
          </View>

          {isConfigured ? (
            <View className="mt-3 gap-2">
              <Text className="text-muted-foreground text-xs">
                Server: {serverUrl || "localhost"}
              </Text>
              <Text className="text-muted-foreground text-xs">
                API Key:••••••••
              </Text>
              <Button
                className="mt-2"
                size="sm"
                variant="ghost"
                onPress={handleClearApiKey}
              >
                <Button.Label>Change Server / Disconnect</Button.Label>
              </Button>
            </View>
          ) : (
            <View className="mt-3">
              <Text className="text-muted-foreground text-sm">
                Not connected. Please log in.
              </Text>
              <Button
                className="mt-2"
                size="sm"
                onPress={() => router.push("/login")}
              >
                <Button.Label>Go to Login</Button.Label>
              </Button>
            </View>
          )}
        </Surface>

        {/* Agents Section */}
        {isAuthenticated ? (
          <>
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-foreground text-xl">
                ACP Agents
              </Text>
              <Button onPress={handleAddNew}>
                <Button.Label>Add Agent</Button.Label>
              </Button>
            </View>

            {agents.length === 0 && !isLoadingAgents ? (
              <Surface className="rounded-lg p-4" variant="secondary">
                <Text className="text-muted-foreground text-sm">
                  No agents configured. Add one to start a session.
                </Text>
              </Surface>
            ) : (
              agents.map((agent: any) => {
                const isActive = activeAgentId === agent.id;
                return (
                  <Card className="gap-3 p-4" key={agent.id}>
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-2">
                        <StyledIcon
                          color={isActive ? themeColorSuccess : themeColorMuted}
                          name={isActive ? "radio-button-on" : "radio-button-off"}
                          size={16}
                        />
                        <Text className="font-semibold text-base text-foreground">
                          {agent.name}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-2">
                        <Pressable onPress={() => handleEdit(agent)}>
                          <StyledIcon
                            color={themeColorMuted}
                            name="create-outline"
                            size={18}
                          />
                        </Pressable>
                        <Pressable
                          onPress={() => handleDelete(agent.id, agent.name)}
                        >
                          <StyledIcon
                            color={themeColorDanger}
                            name="trash-outline"
                            size={18}
                          />
                        </Pressable>
                      </View>
                    </View>

                    <Text className="text-muted-foreground text-xs">
                      {agent.command} {(agent.args || []).join(" ")}
                    </Text>

                    <View className="flex-row flex-wrap gap-2">
                      <View className="rounded-full border border-muted-foreground/40 px-2 py-1">
                        <Text className="text-[10px] text-muted-foreground">
                          {agent.type}
                        </Text>
                      </View>
                      {agent.env && Object.keys(agent.env).length > 0 ? (
                        <View className="rounded-full border border-muted-foreground/40 px-2 py-1">
                          <Text className="text-[10px] text-muted-foreground">
                            {Object.keys(agent.env).length} ENV
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {isActive ? null : (
                      <Button
                        onPress={() => setActiveAgent.mutate({ id: agent.id })}
                        variant="ghost"
                      >
                        <Button.Label>Use This Agent</Button.Label>
                      </Button>
                    )}
                  </Card>
                );
              })
            )}

            <Surface className="rounded-lg p-4" variant="secondary">
              <Text className="mb-3 font-semibold text-base text-foreground">
                {editingId ? "Edit Agent" : "Add Agent"}
              </Text>

              {error && (
                <Text className="mb-3 text-danger text-sm" role="alert">
                  {error}
                </Text>
              )}

              <View className="gap-3">
                <TextField>
                  <TextField.Label>Name</TextField.Label>
                  <TextField.Input
                    autoCapitalize="none"
                    onChangeText={(value) =>
                      setFormData((prev) => ({ ...prev, name: value }))
                    }
                    placeholder="Default (Opencode)"
                    value={formData.name}
                  />
                </TextField>

                <View className="gap-2">
                  <Text className="text-muted-foreground text-xs">Type</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {AGENT_TYPES.map((type) => {
                      const isActive = formData.type === type;
                      return (
                        <Pressable
                          className={`rounded-full border px-3 py-1 ${
                            isActive
                              ? "border-primary bg-primary/10"
                              : "border-muted-foreground/40"
                          }`}
                          key={type}
                          onPress={() =>
                            setFormData((prev) => ({ ...prev, type }))
                          }
                        >
                          <Text
                            className={`text-xs ${
                              isActive
                                ? "text-primary"
                                : "text-muted-foreground"
                            }`}
                          >
                            {type}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <TextField>
                  <TextField.Label>Command</TextField.Label>
                  <TextField.Input
                    autoCapitalize="none"
                    onChangeText={(value) =>
                      setFormData((prev) => ({ ...prev, command: value }))
                    }
                    placeholder="opencode"
                    value={formData.command}
                  />
                </TextField>

                <TextField>
                  <TextField.Label>Arguments</TextField.Label>
                  <TextField.Input
                    autoCapitalize="none"
                    onChangeText={(value) =>
                      setFormData((prev) => ({ ...prev, args: value }))
                    }
                    placeholder="acp"
                    value={formData.args}
                  />
                </TextField>

                <TextField>
                  <TextField.Label>Environment (JSON)</TextField.Label>
                  <TextField.Input
                    autoCapitalize="none"
                    className="font-mono text-xs"
                    multiline
                    numberOfLines={4}
                    onChangeText={(value) =>
                      setFormData((prev) => ({ ...prev, env: value }))
                    }
                    placeholder="{}"
                    value={formData.env}
                  />
                </TextField>

                <Button onPress={handleSave}>
                  <Button.Label>Save Agent</Button.Label>
                </Button>
              </View>
            </Surface>
          </>
        ) : (
          <Surface className="rounded-lg p-4" variant="secondary">
            <Text className="text-muted-foreground text-sm">
              Please connect to the server first to manage agents.
            </Text>
          </Surface>
        )}
      </View>
    </Container>
  );
}
