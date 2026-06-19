// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import {
  Check,
  Edit2,
  Globe,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { renderAgentIcon } from "@/components/left-sidebar/agent-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_SERVER_URL } from "@/lib/server-url";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useServerConfigStore } from "@/store/server-config-store";

type AgentType = "claude" | "codex" | "opencode" | "gemini" | "other";

interface CommandPolicy {
  command: string;
  allowAnyArgs?: boolean;
  allowedArgs?: string[];
  allowedArgPatterns?: string[];
}

interface SettingsPageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

interface SettingsSectionProps {
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
}

const DESKTOP_AGENT_ENV_KEYS = [
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "NODE_ENV",
  "BUN_ENV",
  "TERM",
  "SHELL",
  "DEBUG",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

function normalizeCommandKey(command: string): string {
  return command.trim().toLowerCase();
}

function mergeCommandPolicies(
  existing: CommandPolicy[],
  next: CommandPolicy[]
): CommandPolicy[] {
  const merged: CommandPolicy[] = [];
  const seen = new Set<string>();

  for (const policy of [...existing, ...next]) {
    const command = policy.command.trim();
    if (!command) {
      continue;
    }
    const key = normalizeCommandKey(command);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({ ...policy, command });
  }

  return merged;
}

function mergeEnvKeys(existing: string[], next: readonly string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const key of [...existing, ...next]) {
    const normalized = key.trim();
    if (!normalized) {
      continue;
    }
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    merged.push(normalized);
  }
  return merged;
}

export function SettingsPageHeader({
  title,
  description,
  action,
}: SettingsPageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b pb-4">
      <div className="min-w-0">
        <h1 className="font-semibold text-xl">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-muted-foreground text-xs leading-5">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  icon: Icon,
  action,
  children,
}: SettingsSectionProps) {
  return (
    <section className="border bg-background">
      <div className="flex min-h-11 items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-medium text-sm">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{title}</span>
          </h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-muted-foreground text-xs leading-5">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function ServerConnectionPanel() {
  const { serverUrl, setServerUrl } = useServerConfigStore();

  return (
    <SettingsSection
      description="Browser sessions use better-auth cookies. Changing the target server requires signing in again."
      icon={Globe}
      title="Server Connection"
    >
      <div className="grid max-w-2xl gap-2">
        <Label className="text-xs" htmlFor="serverUrl">
          Server URL
        </Label>
        <Input
          id="serverUrl"
          onChange={(event) => setServerUrl(event.target.value)}
          placeholder={DEFAULT_SERVER_URL}
          value={serverUrl}
        />
      </div>
    </SettingsSection>
  );
}

export function RuntimeAllowlistPanel() {
  const utils = trpc.useUtils();
  const desktopBootstrap = useServerConfigStore(
    (state) => state.desktopBootstrap
  );
  const { data: bootAllowlists, isLoading: isBootAllowlistsLoading } =
    trpc.settings.getBootAllowlists.useQuery();
  const updateBootAllowlistsMutation =
    trpc.settings.updateBootAllowlists.useMutation({
      onSuccess: async () => {
        await utils.settings.getBootAllowlists.invalidate();
        toast.success("Runtime allowlist updated");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update runtime allowlist");
      },
    });
  const detectedCliPolicies = React.useMemo<CommandPolicy[]>(
    () =>
      (desktopBootstrap?.runtimeDiagnostics?.cliAvailability ?? [])
        .filter(
          (cli) =>
            cli.available &&
            typeof cli.executablePath === "string" &&
            cli.executablePath.length > 0
        )
        .map((cli) => ({
          command: cli.executablePath as string,
          allowAnyArgs: true,
        })),
    [desktopBootstrap]
  );
  const missingDetectedCliPolicies = React.useMemo(() => {
    const allowed = new Set(
      (bootAllowlists?.allowedAgentCommandPolicies ?? []).map((policy) =>
        normalizeCommandKey(policy.command)
      )
    );
    return detectedCliPolicies.filter(
      (policy) => !allowed.has(normalizeCommandKey(policy.command))
    );
  }, [bootAllowlists, detectedCliPolicies]);

  const handleSyncDetectedCliPolicies = () => {
    if (!bootAllowlists) {
      return;
    }
    updateBootAllowlistsMutation.mutate({
      allowedAgentCommandPolicies: mergeCommandPolicies(
        bootAllowlists.allowedAgentCommandPolicies,
        detectedCliPolicies
      ),
      allowedEnvKeys: mergeEnvKeys(
        bootAllowlists.allowedEnvKeys,
        DESKTOP_AGENT_ENV_KEYS
      ),
    });
  };

  return (
    <SettingsSection
      action={
        <Button
          disabled={
            !bootAllowlists ||
            detectedCliPolicies.length === 0 ||
            updateBootAllowlistsMutation.isPending
          }
          onClick={handleSyncDetectedCliPolicies}
          size="sm"
          variant="outline"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Sync Detected CLIs
        </Button>
      }
      description="Controls which local commands and environment keys can reach agent processes."
      icon={ShieldCheck}
      title="Runtime Allowlist"
    >
      <div className="grid gap-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {isBootAllowlistsLoading
              ? "Loading agent policies"
              : `${
                  bootAllowlists?.allowedAgentCommandPolicies.length ?? 0
                } agent commands`}
          </Badge>
          <Badge variant="outline">
            {isBootAllowlistsLoading
              ? "Loading ENV keys"
              : `${bootAllowlists?.allowedEnvKeys.length ?? 0} ENV keys`}
          </Badge>
          {missingDetectedCliPolicies.length > 0 ? (
            <Badge variant="destructive">
              {missingDetectedCliPolicies.length} detected missing
            </Badge>
          ) : null}
        </div>

        {bootAllowlists?.warnings?.length ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-destructive text-xs">
            {bootAllowlists.warnings.slice(0, 2).join(" ")}
          </div>
        ) : null}

        <div className="grid gap-1">
          {(bootAllowlists?.allowedAgentCommandPolicies ?? [])
            .slice(0, 8)
            .map((policy) => (
              <code
                className="block overflow-hidden text-ellipsis whitespace-nowrap rounded bg-muted px-2 py-1 text-xs"
                key={policy.command}
                title={policy.command}
              >
                {policy.command}
              </code>
            ))}
          {!isBootAllowlistsLoading &&
          (bootAllowlists?.allowedAgentCommandPolicies.length ?? 0) === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-muted-foreground text-xs">
              No agent command policies.
            </div>
          ) : null}
        </div>
      </div>
    </SettingsSection>
  );
}

export function AgentSettingsPanel() {
  const utils = trpc.useUtils();
  const { data: agentsData, isLoading } = trpc.agents.list.useQuery();
  const [isEditOpen, setIsEditOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [formData, setFormData] = React.useState<{
    name: string;
    type: AgentType;
    command: string;
    args: string;
    resumeCommandTemplate: string;
    env: string;
  }>({
    name: "",
    type: "opencode",
    command: "",
    args: "",
    resumeCommandTemplate: "",
    env: "{}",
  });

  const activeAgentId = agentsData?.activeAgentId ?? null;
  const agents = agentsData?.agents ?? [];

  const createAgentMutation = trpc.agents.create.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
      setIsEditOpen(false);
      toast.success("Agent created");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create agent");
    },
  });

  const updateAgentMutation = trpc.agents.update.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
      setIsEditOpen(false);
      toast.success("Agent updated");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update agent");
    },
  });

  const deleteAgentMutation = trpc.agents.delete.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
      toast.success("Agent deleted");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete agent");
    },
  });

  const setActiveAgentMutation = trpc.agents.setActive.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
      toast.success("Active agent updated");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update active agent");
    },
  });

  const handleAddNew = () => {
    setEditingId(null);
    setFormData({
      name: "",
      type: "opencode",
      command: "",
      args: "",
      resumeCommandTemplate: "",
      env: "{}",
    });
    setIsEditOpen(true);
  };

  const handleEdit = (id: string) => {
    const agent = agents.find((item) => item.id === id);
    if (!agent) {
      toast.error("Agent not found");
      return;
    }
    setEditingId(id);
    setFormData({
      name: agent.name,
      type: agent.type,
      command: agent.command,
      args: (agent.args || []).join(" "),
      resumeCommandTemplate: agent.resumeCommandTemplate ?? "",
      env: JSON.stringify(agent.env || {}, null, 2),
    });
    setIsEditOpen(true);
  };

  const handleDelete = (id: string) => {
    deleteAgentMutation.mutate({ id });
  };

  const handleFormSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    try {
      const envRaw = JSON.parse(formData.env);
      const envParsed =
        envRaw && typeof envRaw === "object" && !Array.isArray(envRaw)
          ? Object.fromEntries(
              Object.entries(envRaw).map(([key, value]) => [key, String(value)])
            )
          : null;

      if (!envParsed) {
        toast.error("ENV must be a JSON object");
        return;
      }

      const payload = {
        name: formData.name.trim(),
        type: formData.type,
        command: formData.command.trim(),
        args: formData.args.split(" ").filter(Boolean),
        resumeCommandTemplate:
          formData.resumeCommandTemplate.trim() || undefined,
        env: envParsed,
      };

      if (editingId) {
        updateAgentMutation.mutate({ id: editingId, ...payload });
      } else {
        createAgentMutation.mutate(payload);
      }
    } catch (error) {
      console.error("Save error:", error);
      toast.error("Invalid ENV JSON");
    }
  };

  const getAgentIcon = (type: string, name?: string) =>
    renderAgentIcon({ agentType: type, agentName: name }, "h-4 w-4");

  return (
    <>
      <SettingsSection
        action={
          <Button onClick={handleAddNew} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Add Agent
          </Button>
        }
        description="Agent commands, arguments, resume templates, and per-agent environment."
        icon={Terminal}
        title="ACP Agents"
      >
        <div className="grid gap-3 xl:grid-cols-2">
          {isLoading ? (
            <Empty className="col-span-full min-h-40 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RefreshCw className="animate-spin" />
                </EmptyMedia>
                <EmptyTitle>Loading agents</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : null}

          {isLoading
            ? null
            : agents.map((agent) => {
                const isActive = activeAgentId === agent.id;
                const args = agent.args || [];
                return (
                  <div
                    className={cn(
                      "flex min-w-0 flex-col gap-4 border bg-background p-3 transition-colors",
                      isActive ? "border-primary bg-accent/30" : ""
                    )}
                    key={agent.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="shrink-0 bg-muted p-2">
                          {getAgentIcon(agent.type, agent.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <h3 className="truncate font-medium text-sm">
                              {agent.name}
                            </h3>
                            {isActive ? (
                              <Badge className="h-5 px-1.5 text-[10px]">
                                Active
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-1 flex gap-2">
                            <Badge
                              className="h-5 text-[10px]"
                              variant="secondary"
                            >
                              {agent.type}
                            </Badge>
                            {agent.env && Object.keys(agent.env).length > 0 ? (
                              <Badge
                                className="h-5 text-[10px]"
                                variant="outline"
                              >
                                {Object.keys(agent.env).length} ENV
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          aria-label={`Edit ${agent.name}`}
                          className="h-8 w-8"
                          onClick={() => handleEdit(agent.id)}
                          size="icon"
                          title="Edit agent"
                          variant="ghost"
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button
                          aria-label={`Delete ${agent.name}`}
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          disabled={isActive}
                          onClick={() => handleDelete(agent.id)}
                          size="icon"
                          title={
                            isActive
                              ? "Cannot delete active agent"
                              : "Delete agent"
                          }
                          variant="ghost"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    <code className="flex min-w-0 items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap bg-muted p-2 text-xs">
                      <Terminal className="inline h-3 w-3 shrink-0" />
                      {agent.command} {args.join(" ")}
                    </code>

                    {isActive ? null : (
                      <Button
                        className="w-full"
                        onClick={() =>
                          setActiveAgentMutation.mutate({ id: agent.id })
                        }
                        size="sm"
                        variant="outline"
                      >
                        <Check className="mr-2 h-3.5 w-3.5" />
                        Use This Agent
                      </Button>
                    )}
                  </div>
                );
              })}

          {!isLoading && agents.length === 0 ? (
            <Empty className="col-span-full min-h-48 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Terminal />
                </EmptyMedia>
                <EmptyTitle>No agents configured</EmptyTitle>
                <EmptyDescription>
                  Add an ACP agent before starting a session.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={handleAddNew} size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Agent
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}
        </div>
      </SettingsSection>

      <Dialog onOpenChange={setIsEditOpen} open={isEditOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <form onSubmit={handleFormSubmit}>
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Agent" : "Add Agent"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  onChange={(event) =>
                    setFormData({ ...formData, name: event.target.value })
                  }
                  placeholder="My Agent"
                  required
                  value={formData.name}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="type">Type</Label>
                  <Select
                    onValueChange={(value: string) => {
                      const validTypes: AgentType[] = [
                        "claude",
                        "codex",
                        "opencode",
                        "gemini",
                        "other",
                      ];
                      if (validTypes.includes(value as AgentType)) {
                        setFormData({
                          ...formData,
                          type: value as AgentType,
                        });
                      }
                    }}
                    value={formData.type}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="claude">Claude code</SelectItem>
                      <SelectItem value="codex">Codex</SelectItem>
                      <SelectItem value="opencode">OpenCode</SelectItem>
                      <SelectItem value="gemini">Gemini CLI</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="cmd">Command</Label>
                  <Input
                    id="cmd"
                    onChange={(event) =>
                      setFormData({ ...formData, command: event.target.value })
                    }
                    placeholder="opencode"
                    required
                    value={formData.command}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="args">Arguments</Label>
                <Input
                  id="args"
                  onChange={(event) =>
                    setFormData({ ...formData, args: event.target.value })
                  }
                  placeholder="acp"
                  value={formData.args}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="resume-command-template">
                  Resume Command Template
                </Label>
                <Input
                  id="resume-command-template"
                  onChange={(event) =>
                    setFormData({
                      ...formData,
                      resumeCommandTemplate: event.target.value,
                    })
                  }
                  placeholder="codex resume <sessionId>"
                  value={formData.resumeCommandTemplate}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="env">Environment (JSON)</Label>
                <Textarea
                  className="min-h-24 font-mono text-xs"
                  id="env"
                  onChange={(event) =>
                    setFormData({ ...formData, env: event.target.value })
                  }
                  placeholder="{}"
                  value={formData.env}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setIsEditOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
