import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  Surface,
  TextField,
  useThemeColor,
  useToast,
} from "heroui-native";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { withUniwind } from "uniwind";

import { AgentIcon } from "@/components/agents/agent-icons";
import { Container } from "@/components/common/container";
import { useAuthConfigured } from "@/hooks/use-auth-config";
import {
  clearStoredBetterAuthSession,
  useBetterAuthClient,
} from "@/lib/auth-client";
import { getDefaultServerUrl } from "@/lib/server-url";
import { trpc } from "@/lib/trpc";
import { useAuthStore } from "@/store/auth-store";

// Wrap Ionicons with Uniwind for className support
const StyledIcon = withUniwind(Ionicons);

const AGENT_TYPES = ["opencode", "codex", "claude", "gemini", "other"] as const;
type IconName = keyof typeof Ionicons.glyphMap;

function SettingsRow({
  icon,
  title,
  value,
  onPress,
  danger = false,
  last = false,
}: {
  icon: IconName;
  title: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const dangerColor = useThemeColor("danger");
  const rowColor = danger ? dangerColor : foreground;

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      className={`min-h-16 flex-row items-center px-5 ${
        last ? "" : "border-default/10 border-b"
      } ${onPress ? "active:bg-default/50" : ""}`}
      onPress={onPress}
    >
      <View className="mr-4 w-7 items-center">
        <Ionicons color={rowColor} name={icon} size={24} />
      </View>
      <Text
        className={`min-w-0 flex-1 text-[17px] ${
          danger ? "text-danger" : "text-foreground"
        }`}
        numberOfLines={1}
      >
        {title}
      </Text>
      {value ? (
        <Text
          className="ml-3 text-muted-foreground text-base"
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <Ionicons
          color={muted}
          name="chevron-forward"
          size={20}
          style={{ marginLeft: 8 }}
        />
      ) : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const themeColorForeground = useThemeColor("foreground");
  const themeColorSuccess = useThemeColor("success");
  const themeColorMuted = useThemeColor("muted");
  const themeColorDanger = useThemeColor("danger");

  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { serverUrl, bumpAuthVersion } = useAuthStore();
  const authClient = useBetterAuthClient(serverUrl || getDefaultServerUrl());
  const session = authClient.useSession();
  const isConfigured = useAuthConfigured();

  // Agent state
  const [editingId, setEditingId] = useState<string | null>(null);
  const emptyForm = {
    name: "",
    type: "opencode" as "claude" | "codex" | "opencode" | "gemini" | "other",
    command: "",
    args: "acp",
    resumeCommandTemplate: "",
    env: "{}",
  };
  const [formData, setFormData] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = async () => {
    try {
      await authClient.signOut();
    } catch {
      // Fail closed below even if the server is unreachable.
    }

    if (serverUrl.trim()) {
      await clearStoredBetterAuthSession(serverUrl);
    }

    bumpAuthVersion();
    toast.show("Signed out");
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
      resumeCommandTemplate: agent.resumeCommandTemplate ?? "",
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
          resumeCommandTemplate:
            formData.resumeCommandTemplate.trim() || undefined,
          env: envParsed,
        });
      } else {
        createAgent.mutate({
          name: formData.name,
          type: formData.type,
          command: formData.command.trim(),
          args: argsParsed,
          resumeCommandTemplate:
            formData.resumeCommandTemplate.trim() || undefined,
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

  const userName =
    session.data?.user?.name ||
    session.data?.user?.username ||
    session.data?.user?.email ||
    "User";
  const userEmail = session.data?.user?.email || serverUrl || "Not connected";

  return (
    <Container className="flex-1 bg-background">
      <View className="px-6 pb-10">
        <View className="relative h-16 flex-row items-center justify-center">
          <Text className="font-semibold text-[19px] text-foreground">
            Settings
          </Text>
          <Pressable
            accessibilityLabel="Close settings"
            accessibilityRole="button"
            className="absolute right-0 h-14 w-14 items-center justify-center rounded-full bg-default active:opacity-80"
            onPress={() => router.replace("/")}
          >
            <Ionicons color={themeColorForeground} name="close" size={30} />
          </Pressable>
        </View>

        <View className="items-center py-7">
          <View className="h-28 w-28 items-center justify-center rounded-full bg-default">
            <Ionicons color={themeColorMuted} name="person" size={56} />
          </View>
          <View className="mt-5 flex-row items-center gap-2">
            <Text
              className="max-w-[260px] text-center font-bold text-3xl text-foreground"
              numberOfLines={1}
            >
              {userName}
            </Text>
            <Chip color="success" size="sm" variant="soft">
              <Chip.Label>Free</Chip.Label>
            </Chip>
          </View>
          <Text className="mt-2 text-center text-muted-foreground text-lg">
            {userEmail}
          </Text>
          <Button
            className="mt-5 rounded-full px-6"
            size="sm"
            variant="secondary"
          >
            <Button.Label>Edit profile</Button.Label>
          </Button>
        </View>

        <View className="gap-3">
          <Surface className="overflow-hidden rounded-2xl p-0">
            <SettingsRow
              icon="person-outline"
              onPress={() => undefined}
              title="Account"
            />
          </Surface>

          <Surface className="overflow-hidden rounded-2xl p-0">
            <SettingsRow
              icon="language-outline"
              title="Language"
              value="English"
            />
            <SettingsRow icon="notifications-outline" title="Notification" last />
          </Surface>

          <Surface className="overflow-hidden rounded-2xl p-0">
            <SettingsRow icon="desktop-outline" title="Device Management" />
            <SettingsRow icon="git-network-outline" title="Connectors" last />
          </Surface>

          <Surface className="overflow-hidden rounded-2xl p-0">
            <SettingsRow
              icon="shield-checkmark-outline"
              title="Privacy & Permissions"
              last
            />
          </Surface>

          <Surface className="overflow-hidden rounded-2xl p-0">
            <SettingsRow icon="code-working-outline" title="About SOLO" last />
          </Surface>

          <Surface className="overflow-hidden rounded-2xl p-0">
            {isConfigured ? (
              <SettingsRow
                danger
                icon="log-out-outline"
                last
                onPress={handleSignOut}
                title="Log out"
              />
            ) : (
              <SettingsRow
                icon="log-in-outline"
                last
                onPress={() => router.push("/login")}
                title="Log in"
              />
            )}
          </Surface>
        </View>

        <View className="mt-9 flex-row items-center justify-between">
          <Text className="font-semibold text-foreground text-2xl">
            ACP Agents
          </Text>
          <Button className="rounded-full" onPress={handleAddNew} size="sm">
            <Button.Label>Add</Button.Label>
          </Button>
        </View>

        {isAuthenticated ? (
          <View className="mt-4 gap-3">
            {agents.length === 0 && !isLoadingAgents ? (
              <Surface className="rounded-2xl p-5" variant="secondary">
                <Text className="text-muted-foreground text-sm">
                  No agents configured.
                </Text>
              </Surface>
            ) : (
              agents.map((agent: any) => {
                const isActive = activeAgentId === agent.id;
                return (
                  <Card className="gap-3 rounded-2xl p-4" key={agent.id}>
                    <View className="flex-row items-center justify-between">
                      <View className="min-w-0 flex-1 flex-row items-center gap-3">
                        <StyledIcon
                          color={isActive ? themeColorSuccess : themeColorMuted}
                          name={
                            isActive ? "radio-button-on" : "radio-button-off"
                          }
                          size={16}
                        />
                        <AgentIcon
                          color={themeColorForeground}
                          secondaryColor={themeColorMuted}
                          size={20}
                          type={agent.type}
                        />
                        <Text
                          className="min-w-0 flex-1 font-semibold text-base text-foreground"
                          numberOfLines={1}
                        >
                          {agent.name}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-3">
                        <Pressable onPress={() => handleEdit(agent)}>
                          <StyledIcon
                            color={themeColorMuted}
                            name="create-outline"
                            size={20}
                          />
                        </Pressable>
                        <Pressable
                          onPress={() => handleDelete(agent.id, agent.name)}
                        >
                          <StyledIcon
                            color={themeColorDanger}
                            name="trash-outline"
                            size={20}
                          />
                        </Pressable>
                      </View>
                    </View>

                    <Text
                      className="text-muted-foreground text-xs"
                      numberOfLines={1}
                    >
                      {agent.command} {(agent.args || []).join(" ")}
                    </Text>

                    <View className="flex-row flex-wrap gap-2">
                      <Chip size="sm" variant="tertiary">
                        <Chip.Label>{agent.type}</Chip.Label>
                      </Chip>
                      {agent.env && Object.keys(agent.env).length > 0 ? (
                        <Chip size="sm" variant="tertiary">
                          <Chip.Label>
                            {Object.keys(agent.env).length} ENV
                          </Chip.Label>
                        </Chip>
                      ) : null}
                    </View>

                    {isActive ? null : (
                      <Button
                        className="self-start rounded-full"
                        onPress={() => setActiveAgent.mutate({ id: agent.id })}
                        size="sm"
                        variant="secondary"
                      >
                        <Button.Label>Use agent</Button.Label>
                      </Button>
                    )}
                  </Card>
                );
              })
            )}

            <Surface className="rounded-2xl p-5" variant="secondary">
              <Text className="mb-4 font-semibold text-base text-foreground">
                {editingId ? "Edit Agent" : "Add Agent"}
              </Text>

              {error ? (
                <Text className="mb-3 text-danger text-sm" role="alert">
                  {error}
                </Text>
              ) : null}

              <View className="gap-3">
                <TextField>
                  <Label>Name</Label>
                  <Input
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
                        <Chip
                          key={type}
                          onPress={() =>
                            setFormData((prev) => ({ ...prev, type }))
                          }
                          variant={isActive ? "primary" : "tertiary"}
                        >
                          <Chip.Label>{type}</Chip.Label>
                        </Chip>
                      );
                    })}
                  </View>
                </View>

                <TextField>
                  <Label>Command</Label>
                  <Input
                    autoCapitalize="none"
                    onChangeText={(value) =>
                      setFormData((prev) => ({ ...prev, command: value }))
                    }
                    placeholder="opencode"
                    value={formData.command}
                  />
                </TextField>

                <TextField>
                  <Label>Arguments</Label>
                  <Input
                    autoCapitalize="none"
                    onChangeText={(value) =>
                      setFormData((prev) => ({ ...prev, args: value }))
                    }
                    placeholder="acp"
                    value={formData.args}
                  />
                </TextField>

                <TextField>
                  <Label>Resume Command Template</Label>
                  <Input
                    autoCapitalize="none"
                    onChangeText={(value) =>
                      setFormData((prev) => ({
                        ...prev,
                        resumeCommandTemplate: value,
                      }))
                    }
                    placeholder="codex resume <sessionId>"
                    value={formData.resumeCommandTemplate}
                  />
                </TextField>

                <TextField>
                  <Label>Environment (JSON)</Label>
                  <Input
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

                <Button className="rounded-full" onPress={handleSave}>
                  <Button.Label>Save Agent</Button.Label>
                </Button>
              </View>
            </Surface>
          </View>
        ) : (
          <Surface className="mt-4 rounded-2xl p-5" variant="secondary">
            <Text className="text-muted-foreground text-sm">
              Connect to manage agents.
            </Text>
          </Surface>
        )}
      </View>
    </Container>
  );
}
