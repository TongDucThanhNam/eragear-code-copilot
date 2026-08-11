// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import {
  Bot,
  Check,
  Edit2,
  Globe,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
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
import { Switch } from "@/components/ui/switch";
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
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-muted-foreground text-sm leading-6">
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
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card/20">
      <div className="flex min-h-12 items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2.5 font-semibold text-base">
            <Icon className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate">{title}</span>
          </h2>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-muted-foreground text-xs leading-5">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
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

const DEFAULT_SUPERVISOR_MODEL = "MiniMax-M3";
const DEFAULT_SUPERVISOR_DECISION_TIMEOUT_MS = 30_000;
const DEFAULT_SUPERVISOR_DECISION_MAX_ATTEMPTS = 2;
const DEFAULT_SUPERVISOR_MAX_RUNTIME_MS = 1_800_000;
const DEFAULT_SUPERVISOR_MAX_REPEATED_PROMPTS = 20;
const DEFAULT_SUPERVISOR_OBSIDIAN_COMMAND = "obsidian";
const DEFAULT_SUPERVISOR_OBSIDIAN_SEARCH_PATH = "Project";
const DEFAULT_SUPERVISOR_OBSIDIAN_SEARCH_LIMIT = 3;
const DEFAULT_SUPERVISOR_OBSIDIAN_TIMEOUT_MS = 5000;

type SupervisorWebSearchProvider = "none" | "exa";
type SupervisorMemoryProvider = "none" | "obsidian";
type SupervisorToolPolicy = "builtin" | "custom-allowlist";

function isMiniMaxSupervisorModel(model: string): boolean {
  const normalized = model.trim();
  return normalized === "MiniMax-M3" || normalized === "minimax/MiniMax-M3";
}

function parseSupervisorInteger(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
}

function parseSupervisorToolAllowlist(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n]/g)
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    ),
  ];
}

function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export function SupervisorSettingsPanel() {
  return (
    <SettingsSection
      description="Manager planning and worker execution now run through ACP agent profiles. Legacy direct-model Supervisor settings are retained only for stored-data compatibility."
      icon={Bot}
      title="Supervisos Manager Mode"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">ACP control plane is active</p>
          <p className="text-xs text-muted-foreground">
            Configure agent roles, concurrency, readiness, and exact-resume
            checks in Mission Control. MiniMax credentials are no longer used by
            active Supervisor paths.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/mission-control">Open Mission Control</a>
        </Button>
      </div>
    </SettingsSection>
  );
}

/** @deprecated Compatibility-only form; intentionally absent from navigation. */
export function LegacySupervisorSettingsPanel() {
  const utils = trpc.useUtils();
  const settingsQuery = trpc.settings.get.useQuery(undefined, {
    staleTime: 30_000,
  });
  const [form, setForm] = React.useState({
    enabled: false,
    model: "",
    miniMaxApiKey: "",
    decisionTimeoutMs: String(DEFAULT_SUPERVISOR_DECISION_TIMEOUT_MS),
    decisionMaxAttempts: String(DEFAULT_SUPERVISOR_DECISION_MAX_ATTEMPTS),
    maxRuntimeMs: String(DEFAULT_SUPERVISOR_MAX_RUNTIME_MS),
    maxRepeatedPrompts: String(DEFAULT_SUPERVISOR_MAX_REPEATED_PROMPTS),
    customSystemPrompt: "",
    toolPolicy: "builtin" as SupervisorToolPolicy,
    toolAllowlist: "",
    webSearchProvider: "none" as SupervisorWebSearchProvider,
    webSearchApiKey: "",
    memoryProvider: "none" as SupervisorMemoryProvider,
    obsidianCommand: DEFAULT_SUPERVISOR_OBSIDIAN_COMMAND,
    obsidianVault: "",
    obsidianBlueprintPath: "",
    obsidianLogPath: "",
    obsidianSearchPath: DEFAULT_SUPERVISOR_OBSIDIAN_SEARCH_PATH,
    obsidianSearchLimit: String(DEFAULT_SUPERVISOR_OBSIDIAN_SEARCH_LIMIT),
    obsidianTimeoutMs: String(DEFAULT_SUPERVISOR_OBSIDIAN_TIMEOUT_MS),
  });
  const updateAppMutation = trpc.settings.updateApp.useMutation({
    onSuccess: async (result) => {
      utils.settings.get.setData(undefined, result.settings);
      await utils.settings.get.invalidate();
      toast.success("Supervisor settings updated");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update Supervisor settings");
    },
  });

  React.useEffect(() => {
    const app = settingsQuery.data?.app;
    if (!app) {
      return;
    }
    setForm({
      enabled: app.supervisorEnabled,
      model: app.supervisorModel,
      miniMaxApiKey: app.supervisorMiniMaxApiKey,
      decisionTimeoutMs: String(app.supervisorDecisionTimeoutMs),
      decisionMaxAttempts: String(app.supervisorDecisionMaxAttempts),
      maxRuntimeMs: String(app.supervisorMaxRuntimeMs),
      maxRepeatedPrompts: String(app.supervisorMaxRepeatedPrompts),
      customSystemPrompt: app.supervisorCustomSystemPrompt,
      toolPolicy: app.supervisorToolPolicy,
      toolAllowlist: app.supervisorToolAllowlist.join("\n"),
      webSearchProvider: app.supervisorWebSearchProvider,
      webSearchApiKey: app.supervisorWebSearchApiKey,
      memoryProvider: app.supervisorMemoryProvider,
      obsidianCommand: app.supervisorObsidianCommand,
      obsidianVault: app.supervisorObsidianVault,
      obsidianBlueprintPath: app.supervisorObsidianBlueprintPath,
      obsidianLogPath: app.supervisorObsidianLogPath,
      obsidianSearchPath: app.supervisorObsidianSearchPath,
      obsidianSearchLimit: String(app.supervisorObsidianSearchLimit),
      obsidianTimeoutMs: String(app.supervisorObsidianTimeoutMs),
    });
  }, [
    settingsQuery.data?.app.supervisorEnabled,
    settingsQuery.data?.app.supervisorModel,
    settingsQuery.data?.app.supervisorMiniMaxApiKey,
    settingsQuery.data?.app.supervisorDecisionTimeoutMs,
    settingsQuery.data?.app.supervisorDecisionMaxAttempts,
    settingsQuery.data?.app.supervisorMaxRuntimeMs,
    settingsQuery.data?.app.supervisorMaxRepeatedPrompts,
    settingsQuery.data?.app.supervisorCustomSystemPrompt,
    settingsQuery.data?.app.supervisorToolPolicy,
    settingsQuery.data?.app.supervisorToolAllowlist,
    settingsQuery.data?.app.supervisorWebSearchProvider,
    settingsQuery.data?.app.supervisorWebSearchApiKey,
    settingsQuery.data?.app.supervisorMemoryProvider,
    settingsQuery.data?.app.supervisorObsidianCommand,
    settingsQuery.data?.app.supervisorObsidianVault,
    settingsQuery.data?.app.supervisorObsidianBlueprintPath,
    settingsQuery.data?.app.supervisorObsidianLogPath,
    settingsQuery.data?.app.supervisorObsidianSearchPath,
    settingsQuery.data?.app.supervisorObsidianSearchLimit,
    settingsQuery.data?.app.supervisorObsidianTimeoutMs,
  ]);

  const app = settingsQuery.data?.app;
  const trimmedModel = form.model.trim();
  const trimmedMiniMaxApiKey = form.miniMaxApiKey.trim();
  const trimmedCustomSystemPrompt = form.customSystemPrompt.trim();
  const parsedToolAllowlist = parseSupervisorToolAllowlist(form.toolAllowlist);
  const trimmedWebSearchApiKey = form.webSearchApiKey.trim();
  const trimmedObsidianCommand = form.obsidianCommand.trim();
  const trimmedObsidianVault = form.obsidianVault.trim();
  const trimmedObsidianBlueprintPath = form.obsidianBlueprintPath.trim();
  const trimmedObsidianLogPath = form.obsidianLogPath.trim();
  const trimmedObsidianSearchPath = form.obsidianSearchPath.trim();
  const decisionTimeoutMs = parseSupervisorInteger(form.decisionTimeoutMs);
  const decisionMaxAttempts = parseSupervisorInteger(form.decisionMaxAttempts);
  const maxRuntimeMs = parseSupervisorInteger(form.maxRuntimeMs);
  const maxRepeatedPrompts = parseSupervisorInteger(form.maxRepeatedPrompts);
  const obsidianSearchLimit = parseSupervisorInteger(form.obsidianSearchLimit);
  const obsidianTimeoutMs = parseSupervisorInteger(form.obsidianTimeoutMs);
  const usesMiniMax = isMiniMaxSupervisorModel(trimmedModel);
  const missingModel = form.enabled && trimmedModel.length === 0;
  const missingMiniMaxKey =
    form.enabled && usesMiniMax && trimmedMiniMaxApiKey.length === 0;
  const missingWebSearchApiKey =
    form.webSearchProvider === "exa" && trimmedWebSearchApiKey.length === 0;
  const missingObsidianCommand =
    form.memoryProvider === "obsidian" && trimmedObsidianCommand.length === 0;
  const missingObsidianSearchPath =
    form.memoryProvider === "obsidian" &&
    trimmedObsidianSearchPath.length === 0;
  const invalidNumbers =
    decisionTimeoutMs === null ||
    decisionTimeoutMs < 1000 ||
    decisionTimeoutMs > 120_000 ||
    decisionMaxAttempts === null ||
    decisionMaxAttempts < 1 ||
    decisionMaxAttempts > 10 ||
    maxRuntimeMs === null ||
    maxRuntimeMs < 1000 ||
    maxRuntimeMs > 86_400_000 ||
    maxRepeatedPrompts === null ||
    maxRepeatedPrompts < 1 ||
    maxRepeatedPrompts > 200 ||
    obsidianSearchLimit === null ||
    obsidianSearchLimit < 1 ||
    obsidianSearchLimit > 20 ||
    obsidianTimeoutMs === null ||
    obsidianTimeoutMs < 1000 ||
    obsidianTimeoutMs > 60_000;
  const hasChanges = app
    ? form.enabled !== app.supervisorEnabled ||
      trimmedModel !== app.supervisorModel ||
      trimmedMiniMaxApiKey !== app.supervisorMiniMaxApiKey ||
      decisionTimeoutMs !== app.supervisorDecisionTimeoutMs ||
      decisionMaxAttempts !== app.supervisorDecisionMaxAttempts ||
      maxRuntimeMs !== app.supervisorMaxRuntimeMs ||
      maxRepeatedPrompts !== app.supervisorMaxRepeatedPrompts ||
      trimmedCustomSystemPrompt !== app.supervisorCustomSystemPrompt ||
      form.toolPolicy !== app.supervisorToolPolicy ||
      !sameStringList(parsedToolAllowlist, app.supervisorToolAllowlist) ||
      form.webSearchProvider !== app.supervisorWebSearchProvider ||
      trimmedWebSearchApiKey !== app.supervisorWebSearchApiKey ||
      form.memoryProvider !== app.supervisorMemoryProvider ||
      trimmedObsidianCommand !== app.supervisorObsidianCommand ||
      trimmedObsidianVault !== app.supervisorObsidianVault ||
      trimmedObsidianBlueprintPath !== app.supervisorObsidianBlueprintPath ||
      trimmedObsidianLogPath !== app.supervisorObsidianLogPath ||
      trimmedObsidianSearchPath !== app.supervisorObsidianSearchPath ||
      obsidianSearchLimit !== app.supervisorObsidianSearchLimit ||
      obsidianTimeoutMs !== app.supervisorObsidianTimeoutMs
    : false;
  const isBusy = settingsQuery.isFetching || updateAppMutation.isPending;
  const statusLabel = form.enabled
    ? missingModel || missingMiniMaxKey || missingWebSearchApiKey
      ? "Needs setup"
      : "Enabled"
    : "Off";

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (missingModel) {
      toast.error("Supervisor model is required");
      return;
    }
    if (missingMiniMaxKey) {
      toast.error("MiniMax API key is required for MiniMax-M3 Supervisor");
      return;
    }
    if (missingWebSearchApiKey) {
      toast.error("Exa API key is required when web search is set to Exa");
      return;
    }
    if (missingObsidianCommand || missingObsidianSearchPath) {
      toast.error("Obsidian command and search path are required");
      return;
    }
    if (
      invalidNumbers ||
      decisionTimeoutMs === null ||
      decisionMaxAttempts === null ||
      maxRuntimeMs === null ||
      maxRepeatedPrompts === null ||
      obsidianSearchLimit === null ||
      obsidianTimeoutMs === null
    ) {
      toast.error("Supervisor numeric settings are out of range");
      return;
    }
    updateAppMutation.mutate({
      supervisorEnabled: form.enabled,
      supervisorModel: trimmedModel,
      supervisorMiniMaxApiKey: trimmedMiniMaxApiKey,
      supervisorDecisionTimeoutMs: decisionTimeoutMs,
      supervisorDecisionMaxAttempts: decisionMaxAttempts,
      supervisorMaxRuntimeMs: maxRuntimeMs,
      supervisorMaxRepeatedPrompts: maxRepeatedPrompts,
      supervisorCustomSystemPrompt: trimmedCustomSystemPrompt,
      supervisorToolPolicy: form.toolPolicy,
      supervisorToolAllowlist: parsedToolAllowlist,
      supervisorWebSearchProvider: form.webSearchProvider,
      supervisorWebSearchApiKey: trimmedWebSearchApiKey,
      supervisorMemoryProvider: form.memoryProvider,
      supervisorObsidianCommand: trimmedObsidianCommand,
      supervisorObsidianVault: trimmedObsidianVault,
      supervisorObsidianBlueprintPath: trimmedObsidianBlueprintPath,
      supervisorObsidianLogPath: trimmedObsidianLogPath,
      supervisorObsidianSearchPath: trimmedObsidianSearchPath,
      supervisorObsidianSearchLimit: obsidianSearchLimit,
      supervisorObsidianTimeoutMs: obsidianTimeoutMs,
    });
  };

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy}
          onClick={() => {
            settingsQuery.refetch().catch(() => undefined);
          }}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={cn(
              "mr-2 h-4 w-4",
              settingsQuery.isFetching ? "animate-spin" : ""
            )}
          />
          Refresh
        </Button>
      }
      description="Configure the project supervisor used by the Supervisos panel."
      icon={Bot}
      title="Project Supervisor"
    >
      <form className="grid max-w-3xl gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={
              form.enabled
                ? missingModel || missingMiniMaxKey || missingWebSearchApiKey
                  ? "destructive"
                  : "secondary"
                : "outline"
            }
          >
            {statusLabel}
          </Badge>
          {usesMiniMax ? <Badge variant="outline">MiniMax-M3</Badge> : null}
          {form.webSearchProvider === "exa" ? (
            <Badge variant="outline">Exa</Badge>
          ) : null}
          {form.memoryProvider === "obsidian" ? (
            <Badge variant="outline">Obsidian</Badge>
          ) : null}
          {trimmedCustomSystemPrompt ? (
            <Badge variant="outline">Custom prompt</Badge>
          ) : null}
          {form.toolPolicy === "custom-allowlist" ? (
            <Badge variant="outline">{parsedToolAllowlist.length} tools</Badge>
          ) : null}
        </div>

        <label
          className="flex items-center justify-between gap-4 rounded-md border bg-background p-3"
          htmlFor="supervisor-enabled"
        >
          <span className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <Bot className="h-4 w-4 text-muted-foreground" />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-sm">
                Enable project supervisor
              </span>
              <span className="mt-1 block max-w-2xl text-muted-foreground text-xs leading-5">
                Enables the Supervisor controls in the Supervisos panel for
                project sessions.
              </span>
            </span>
          </span>
          <Switch
            checked={form.enabled}
            disabled={isBusy}
            id="supervisor-enabled"
            onCheckedChange={(enabled) =>
              setForm((prev) => ({
                ...prev,
                enabled,
                model:
                  enabled && prev.model.trim().length === 0
                    ? DEFAULT_SUPERVISOR_MODEL
                    : prev.model,
              }))
            }
          />
        </label>

        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <div className="grid gap-1.5">
            <Label htmlFor="supervisor-model">Supervisor model</Label>
            <Input
              autoComplete="off"
              disabled={isBusy}
              id="supervisor-model"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, model: event.target.value }))
              }
              placeholder={DEFAULT_SUPERVISOR_MODEL}
              value={form.model}
            />
          </div>
          <div className="grid gap-1.5">
            <Label
              className="flex items-center gap-1.5"
              htmlFor="supervisor-key"
            >
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
              MiniMax API key
            </Label>
            <Input
              autoComplete="off"
              disabled={isBusy}
              id="supervisor-key"
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  miniMaxApiKey: event.target.value,
                }))
              }
              placeholder="sk-..."
              type="password"
              value={form.miniMaxApiKey}
            />
          </div>
        </div>

        <div className="grid gap-3 rounded-md border bg-background p-3">
          <div className="grid gap-1.5">
            <Label htmlFor="supervisor-custom-system-prompt">
              System prompt
            </Label>
            <Textarea
              className="min-h-28 resize-y"
              disabled={isBusy}
              id="supervisor-custom-system-prompt"
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  customSystemPrompt: event.target.value,
                }))
              }
              placeholder="Extra Supervisos instructions..."
              value={form.customSystemPrompt}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <div className="grid gap-1.5">
              <Label htmlFor="supervisor-tool-policy">Tool policy</Label>
              <Select
                disabled={isBusy}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    toolPolicy: value as SupervisorToolPolicy,
                  }))
                }
                value={form.toolPolicy}
              >
                <SelectTrigger id="supervisor-tool-policy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="builtin">
                    Built-in session tools
                  </SelectItem>
                  <SelectItem value="custom-allowlist">
                    Custom allowlist
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="supervisor-tool-allowlist">Tool allowlist</Label>
              <Textarea
                className="min-h-20 resize-y"
                disabled={isBusy || form.toolPolicy !== "custom-allowlist"}
                id="supervisor-tool-allowlist"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    toolAllowlist: event.target.value,
                  }))
                }
                placeholder={"exa-search\nobsidian\nmcp/tool-name"}
                value={form.toolAllowlist}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 rounded-md border bg-background p-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="supervisor-decision-timeout">
                Decision timeout
              </Label>
              <Input
                disabled={isBusy}
                id="supervisor-decision-timeout"
                max={120000}
                min={1000}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    decisionTimeoutMs: event.target.value,
                  }))
                }
                type="number"
                value={form.decisionTimeoutMs}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="supervisor-decision-attempts">Attempts</Label>
              <Input
                disabled={isBusy}
                id="supervisor-decision-attempts"
                max={10}
                min={1}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    decisionMaxAttempts: event.target.value,
                  }))
                }
                type="number"
                value={form.decisionMaxAttempts}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="supervisor-max-runtime">Max runtime</Label>
              <Input
                disabled={isBusy}
                id="supervisor-max-runtime"
                max={86400000}
                min={1000}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    maxRuntimeMs: event.target.value,
                  }))
                }
                type="number"
                value={form.maxRuntimeMs}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="supervisor-repeated-prompts">Repeat cap</Label>
              <Input
                disabled={isBusy}
                id="supervisor-repeated-prompts"
                max={200}
                min={1}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    maxRepeatedPrompts: event.target.value,
                  }))
                }
                type="number"
                value={form.maxRepeatedPrompts}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <div className="grid gap-1.5">
            <Label htmlFor="supervisor-web-search">Web search</Label>
            <Select
              disabled={isBusy}
              onValueChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  webSearchProvider: value as SupervisorWebSearchProvider,
                }))
              }
              value={form.webSearchProvider}
            >
              <SelectTrigger id="supervisor-web-search">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="exa">Exa</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label
              className="flex items-center gap-1.5"
              htmlFor="supervisor-web-search-key"
            >
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
              Search API key
            </Label>
            <Input
              autoComplete="off"
              disabled={isBusy}
              id="supervisor-web-search-key"
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  webSearchApiKey: event.target.value,
                }))
              }
              placeholder="Exa API key"
              type="password"
              value={form.webSearchApiKey}
            />
          </div>
        </div>

        <div className="grid gap-3 rounded-md border bg-background p-3">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <div className="grid gap-1.5">
              <Label htmlFor="supervisor-memory-provider">Memory</Label>
              <Select
                disabled={isBusy}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    memoryProvider: value as SupervisorMemoryProvider,
                  }))
                }
                value={form.memoryProvider}
              >
                <SelectTrigger id="supervisor-memory-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="obsidian">Obsidian</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="supervisor-obsidian-command">
                Obsidian command
              </Label>
              <Input
                autoComplete="off"
                disabled={isBusy}
                id="supervisor-obsidian-command"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    obsidianCommand: event.target.value,
                  }))
                }
                value={form.obsidianCommand}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <div className="grid gap-1.5">
              <Label htmlFor="supervisor-obsidian-vault">Vault</Label>
              <Input
                autoComplete="off"
                disabled={isBusy}
                id="supervisor-obsidian-vault"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    obsidianVault: event.target.value,
                  }))
                }
                value={form.obsidianVault}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="supervisor-obsidian-search-path">
                Search path
              </Label>
              <Input
                autoComplete="off"
                disabled={isBusy}
                id="supervisor-obsidian-search-path"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    obsidianSearchPath: event.target.value,
                  }))
                }
                value={form.obsidianSearchPath}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <div className="grid gap-1.5">
              <Label htmlFor="supervisor-obsidian-blueprint">
                Blueprint path
              </Label>
              <Input
                autoComplete="off"
                disabled={isBusy}
                id="supervisor-obsidian-blueprint"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    obsidianBlueprintPath: event.target.value,
                  }))
                }
                value={form.obsidianBlueprintPath}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="supervisor-obsidian-log">Log path</Label>
              <Input
                autoComplete="off"
                disabled={isBusy}
                id="supervisor-obsidian-log"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    obsidianLogPath: event.target.value,
                  }))
                }
                value={form.obsidianLogPath}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <div className="grid gap-1.5">
              <Label htmlFor="supervisor-obsidian-limit">Search limit</Label>
              <Input
                disabled={isBusy}
                id="supervisor-obsidian-limit"
                max={20}
                min={1}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    obsidianSearchLimit: event.target.value,
                  }))
                }
                type="number"
                value={form.obsidianSearchLimit}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="supervisor-obsidian-timeout">
                Command timeout
              </Label>
              <Input
                disabled={isBusy}
                id="supervisor-obsidian-timeout"
                max={60000}
                min={1000}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    obsidianTimeoutMs: event.target.value,
                  }))
                }
                type="number"
                value={form.obsidianTimeoutMs}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            disabled={
              isBusy ||
              !hasChanges ||
              missingModel ||
              missingMiniMaxKey ||
              missingWebSearchApiKey ||
              missingObsidianCommand ||
              missingObsidianSearchPath ||
              invalidNumbers
            }
            type="submit"
          >
            <Save className="mr-2 h-4 w-4" />
            Save Supervisor
          </Button>
        </div>
      </form>
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
