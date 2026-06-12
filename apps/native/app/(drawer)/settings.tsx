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
import { type ReactNode, useMemo, useState } from "react";
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

const StyledIcon = withUniwind(Ionicons);

const AGENT_TYPES = ["opencode", "codex", "claude", "gemini", "other"] as const;
type AgentType = (typeof AGENT_TYPES)[number];
type IconName = keyof typeof Ionicons.glyphMap;

type AgentRecord = {
  id: string;
  name: string;
  type: AgentType;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  resumeCommandTemplate?: string | null;
};

type AgentFormState = {
  name: string;
  type: AgentType;
  command: string;
  args: string;
  resumeCommandTemplate: string;
  env: string;
};

const emptyForm: AgentFormState = {
  name: "",
  type: "opencode",
  command: "",
  args: "acp",
  resumeCommandTemplate: "",
  env: "{}",
};

function SettingsHeader({ onClose }: { onClose: () => void }) {
  const foreground = useThemeColor("foreground");

  return (
    <View className="flex-row items-center justify-between pt-2 pb-5">
      <View className="min-w-0 flex-1">
        <Text className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
          Preferences
        </Text>
        <Text className="mt-1 font-bold text-2xl text-foreground">
          Settings
        </Text>
      </View>
      <Pressable
        accessibilityLabel="Close settings"
        accessibilityRole="button"
        className="ml-4 h-11 w-11 items-center justify-center rounded-full bg-default active:opacity-80"
        onPress={onClose}
      >
        <Ionicons color={foreground} name="close" size={22} />
      </Pressable>
    </View>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text className="px-1 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
        {title}
      </Text>
      <Surface className="overflow-hidden rounded-2xl p-0">{children}</Surface>
    </View>
  );
}

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
  const iconColor = danger ? dangerColor : foreground;

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      className={`min-h-[58px] flex-row items-center px-4 ${
        last ? "" : "border-divider/60 border-b"
      } ${onPress ? "active:bg-default/50" : ""}`}
      onPress={onPress}
    >
      <View
        className={`mr-3 h-9 w-9 items-center justify-center rounded-full ${
          danger ? "bg-danger/10" : "bg-default"
        }`}
      >
        <Ionicons color={iconColor} name={icon} size={18} />
      </View>
      <Text
        className={`min-w-0 flex-1 font-medium text-[15px] ${
          danger ? "text-danger" : "text-foreground"
        }`}
        numberOfLines={1}
      >
        {title}
      </Text>
      {value ? (
        <Text
          className="ml-3 max-w-[128px] text-muted-foreground text-sm"
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <Ionicons color={muted} name="chevron-forward" size={18} />
      ) : null}
    </Pressable>
  );
}

function AccountSummary({
  userName,
  userEmail,
  isConfigured,
  onAuthAction,
}: {
  userName: string;
  userEmail: string;
  isConfigured: boolean;
  onAuthAction: () => void;
}) {
  const muted = useThemeColor("muted");
  const actionLabel = isConfigured ? "Log out" : "Log in";

  return (
    <Surface className="rounded-2xl p-4">
      <View className="flex-row items-center gap-3">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-default">
          <Ionicons color={muted} name="person" size={26} />
        </View>
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-2">
            <Text
              className="min-w-0 flex-1 font-semibold text-foreground text-lg"
              numberOfLines={1}
            >
              {userName}
            </Text>
            <Chip color="success" size="sm" variant="soft">
              <Chip.Label>Free</Chip.Label>
            </Chip>
          </View>
          <Text className="mt-1 text-muted-foreground text-sm" numberOfLines={1}>
            {userEmail}
          </Text>
        </View>
        <Button
          className="rounded-full"
          onPress={onAuthAction}
          size="sm"
          variant={isConfigured ? "secondary" : "primary"}
        >
          <Button.Label>{actionLabel}</Button.Label>
        </Button>
      </View>
    </Surface>
  );
}

function AgentCard({
  agent,
  isActive,
  onEdit,
  onDelete,
  onUse,
}: {
  agent: AgentRecord;
  isActive: boolean;
  onEdit: (agent: AgentRecord) => void;
  onDelete: (id: string, name: string) => void;
  onUse: (id: string) => void;
}) {
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const danger = useThemeColor("danger");
  const success = useThemeColor("success");
  const command = [agent.command, ...(agent.args ?? [])].filter(Boolean).join(" ");
  const envCount = agent.env ? Object.keys(agent.env).length : 0;

  return (
    <Card className="gap-3 rounded-2xl p-4">
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-default">
          <AgentIcon
            color={foreground}
            secondaryColor={muted}
            size={22}
            type={agent.type}
          />
        </View>
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-2">
            <Text
              className="min-w-0 flex-1 font-semibold text-base text-foreground"
              numberOfLines={1}
            >
              {agent.name}
            </Text>
            {isActive ? (
              <View className="flex-row items-center gap-1 rounded-full bg-success/10 px-2 py-1">
                <StyledIcon color={success} name="checkmark-circle" size={13} />
                <Text className="font-medium text-[11px] text-success">
                  Active
                </Text>
              </View>
            ) : null}
          </View>
          <Text
            className="mt-1 font-mono text-muted-foreground text-xs"
            numberOfLines={1}
          >
            {command || "No command configured"}
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <Chip size="sm" variant="tertiary">
              <Chip.Label>{agent.type}</Chip.Label>
            </Chip>
            {envCount > 0 ? (
              <Chip size="sm" variant="tertiary">
                <Chip.Label>{envCount} ENV</Chip.Label>
              </Chip>
            ) : null}
          </View>
        </View>
      </View>

      <View className="flex-row items-center justify-between border-divider/60 border-t pt-3">
        <View className="flex-row items-center gap-3">
          <Pressable
            accessibilityLabel={`Edit ${agent.name}`}
            accessibilityRole="button"
            className="h-9 w-9 items-center justify-center rounded-full bg-default active:opacity-80"
            onPress={() => onEdit(agent)}
          >
            <StyledIcon color={muted} name="create-outline" size={18} />
          </Pressable>
          <Pressable
            accessibilityLabel={`Delete ${agent.name}`}
            accessibilityRole="button"
            className="h-9 w-9 items-center justify-center rounded-full bg-danger/10 active:opacity-80"
            onPress={() => onDelete(agent.id, agent.name)}
          >
            <StyledIcon color={danger} name="trash-outline" size={18} />
          </Pressable>
        </View>
        {isActive ? null : (
          <Button
            className="rounded-full"
            onPress={() => onUse(agent.id)}
            size="sm"
            variant="secondary"
          >
            <Button.Label>Use agent</Button.Label>
          </Button>
        )}
      </View>
    </Card>
  );
}

function AgentEmptyState({ onAdd }: { onAdd: () => void }) {
  const muted = useThemeColor("muted");

  return (
    <Surface className="items-center rounded-2xl p-6" variant="secondary">
      <View className="h-12 w-12 items-center justify-center rounded-full bg-default">
        <Ionicons color={muted} name="terminal-outline" size={22} />
      </View>
      <Text className="mt-3 text-center font-semibold text-foreground">
        No agents configured
      </Text>
      <Text className="mt-1 max-w-[260px] text-center text-muted-foreground text-sm leading-5">
        Add an ACP agent before starting sessions from this device.
      </Text>
      <Button className="mt-4 rounded-full" onPress={onAdd} size="sm">
        <Button.Label>Add agent</Button.Label>
      </Button>
    </Surface>
  );
}

function AgentEditor({
  editingId,
  error,
  formData,
  isSaving,
  onCancel,
  onChange,
  onSave,
}: {
  editingId: string | null;
  error: string | null;
  formData: AgentFormState;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (patch: Partial<AgentFormState>) => void;
  onSave: () => void;
}) {
  return (
    <Surface className="rounded-2xl p-4" variant="secondary">
      <View className="mb-4 flex-row items-start justify-between gap-4">
        <View className="min-w-0 flex-1">
          <Text className="font-semibold text-base text-foreground">
            {editingId ? "Edit Agent" : "Add Agent"}
          </Text>
          <Text className="mt-1 text-muted-foreground text-sm leading-5">
            Configure the ACP command this mobile client should use.
          </Text>
        </View>
        <Button
          className="rounded-full"
          onPress={onCancel}
          size="sm"
          variant="tertiary"
        >
          <Button.Label>Cancel</Button.Label>
        </Button>
      </View>

      {error ? (
        <View className="mb-3 rounded-xl bg-danger/10 px-3 py-2">
          <Text className="text-danger text-sm" role="alert">
            {error}
          </Text>
        </View>
      ) : null}

      <View className="gap-3">
        <TextField>
          <Label>Name</Label>
          <Input
            autoCapitalize="none"
            onChangeText={(value) => onChange({ name: value })}
            placeholder="Default (Opencode)"
            value={formData.name}
          />
        </TextField>

        <View className="gap-2">
          <Text className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Type
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {AGENT_TYPES.map((type) => {
              const isActive = formData.type === type;
              return (
                <Chip
                  key={type}
                  onPress={() => onChange({ type })}
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
            onChangeText={(value) => onChange({ command: value })}
            placeholder="opencode"
            value={formData.command}
          />
        </TextField>

        <TextField>
          <Label>Arguments</Label>
          <Input
            autoCapitalize="none"
            onChangeText={(value) => onChange({ args: value })}
            placeholder="acp"
            value={formData.args}
          />
        </TextField>

        <TextField>
          <Label>Resume Command Template</Label>
          <Input
            autoCapitalize="none"
            onChangeText={(value) => onChange({ resumeCommandTemplate: value })}
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
            onChangeText={(value) => onChange({ env: value })}
            placeholder="{}"
            value={formData.env}
          />
        </TextField>

        <Button className="rounded-full" onPress={onSave}>
          <Button.Label>{isSaving ? "Saving..." : "Save Agent"}</Button.Label>
        </Button>
      </View>
    </Surface>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { serverUrl, bumpAuthVersion } = useAuthStore();
  const authClient = useBetterAuthClient(serverUrl || getDefaultServerUrl());
  const session = authClient.useSession();
  const isConfigured = useAuthConfigured();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [formData, setFormData] = useState<AgentFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const { data: agentsData, isLoading: isLoadingAgents } =
    trpc.agents.list.useQuery(undefined, {
      retry: false,
      enabled: isConfigured,
    });

  const closeEditor = () => {
    setIsEditorOpen(false);
    setEditingId(null);
    setFormData(emptyForm);
    setError(null);
  };

  const createAgent = trpc.agents.create.useMutation({
    onSuccess: () => {
      utils.agents.list.invalidate();
      toast.show("Agent created");
      closeEditor();
    },
    onError: (err) => setError(err.message),
  });

  const updateAgent = trpc.agents.update.useMutation({
    onSuccess: () => {
      utils.agents.list.invalidate();
      toast.show("Agent updated");
      closeEditor();
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

  const agents = useMemo<AgentRecord[]>(
    () => (agentsData?.agents ?? []) as AgentRecord[],
    [agentsData?.agents]
  );
  const activeAgentId = agentsData?.activeAgentId;
  const isAuthenticated = isConfigured;
  const isSaving = createAgent.isPending || updateAgent.isPending;

  const userName =
    session.data?.user?.name ||
    session.data?.user?.username ||
    session.data?.user?.email ||
    "User";
  const userEmail = session.data?.user?.email || serverUrl || "Not connected";

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

  const handleAuthAction = () => {
    if (isConfigured) {
      void handleSignOut();
      return;
    }
    router.push("/login");
  };

  const handleEdit = (agent: AgentRecord) => {
    setEditingId(agent.id);
    setFormData({
      name: agent.name,
      type: agent.type,
      command: agent.command,
      args: (agent.args || []).join(" "),
      resumeCommandTemplate: agent.resumeCommandTemplate ?? "",
      env: JSON.stringify(agent.env || {}, null, 2),
    });
    setError(null);
    setIsEditorOpen(true);
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
    setIsEditorOpen(true);
  };

  return (
    <Container className="flex-1 bg-background">
      <View className="gap-6 px-5 pb-10">
        <SettingsHeader onClose={() => router.replace("/")} />

        <AccountSummary
          isConfigured={isConfigured}
          onAuthAction={handleAuthAction}
          userEmail={userEmail}
          userName={userName}
        />

        <View className="gap-5">
          <SettingsSection title="Account">
            <SettingsRow
              icon="person-outline"
              title="Profile"
              value={isConfigured ? "Connected" : "Offline"}
              last
            />
          </SettingsSection>

          <SettingsSection title="Preferences">
            <SettingsRow
              icon="language-outline"
              title="Language"
              value="English"
            />
            <SettingsRow
              icon="notifications-outline"
              title="Notifications"
              value="Default"
              last
            />
          </SettingsSection>

          <SettingsSection title="Workspace">
            <SettingsRow icon="desktop-outline" title="Device Management" />
            <SettingsRow icon="git-network-outline" title="Connectors" last />
          </SettingsSection>

          <SettingsSection title="Security">
            <SettingsRow
              icon="shield-checkmark-outline"
              title="Privacy & Permissions"
              last
            />
          </SettingsSection>

          <SettingsSection title="App">
            <SettingsRow icon="code-working-outline" title="About SOLO" last />
          </SettingsSection>
        </View>

        <View className="gap-3">
          <View className="flex-row items-end justify-between gap-4">
            <View className="min-w-0 flex-1">
              <Text className="font-bold text-2xl text-foreground">
                ACP Agents
              </Text>
              <Text className="mt-1 text-muted-foreground text-sm leading-5">
                Manage command profiles used to launch coding agents.
              </Text>
            </View>
            {isAuthenticated ? (
              <Button
                className="rounded-full"
                onPress={handleAddNew}
                size="sm"
                variant={isEditorOpen ? "secondary" : "primary"}
              >
                <Button.Label>Add</Button.Label>
              </Button>
            ) : null}
          </View>

          {isAuthenticated ? (
            <View className="gap-3">
              {isLoadingAgents ? (
                <Surface className="rounded-2xl p-4" variant="secondary">
                  <Text className="text-muted-foreground text-sm">
                    Loading agents...
                  </Text>
                </Surface>
              ) : agents.length === 0 ? (
                <AgentEmptyState onAdd={handleAddNew} />
              ) : (
                agents.map((agent) => (
                  <AgentCard
                    agent={agent}
                    isActive={activeAgentId === agent.id}
                    key={agent.id}
                    onDelete={handleDelete}
                    onEdit={handleEdit}
                    onUse={(id) => setActiveAgent.mutate({ id })}
                  />
                ))
              )}

              {isEditorOpen ? (
                <AgentEditor
                  editingId={editingId}
                  error={error}
                  formData={formData}
                  isSaving={isSaving}
                  onCancel={closeEditor}
                  onChange={(patch) =>
                    setFormData((prev) => ({ ...prev, ...patch }))
                  }
                  onSave={handleSave}
                />
              ) : null}
            </View>
          ) : (
            <Surface className="rounded-2xl p-4" variant="secondary">
              <Text className="text-muted-foreground text-sm">
                Connect to manage agents.
              </Text>
            </Surface>
          )}
        </View>
      </View>
    </Container>
  );
}
