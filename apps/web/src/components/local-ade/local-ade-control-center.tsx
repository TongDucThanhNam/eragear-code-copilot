"use client";

import type { inferRouterOutputs } from "@trpc/server";
import type { RuntimeDiagnostics } from "@repo/shared";
import {
  Activity,
  Archive,
  Bot,
  CheckCircle2,
  Copy,
  Database,
  Eye,
  FileText,
  GitBranch,
  KeyRound,
  MessageSquare,
  Pause,
  Play,
  PlugZap,
  Radio,
  RefreshCw,
  Save,
  ServerCog,
  ShieldAlert,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  Terminal,
  TestTube2,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { cn } from "@/lib/utils";
import { type AppRouter, trpc } from "@/lib/trpc";
import { useServerConfigStore } from "@/store/server-config-store";
import {
  buildLocalAdeCommandLaunchText,
  getLocalAdeBackgroundSummary,
  getLocalAdeCommandDeckState,
  getLocalAdeCheckpointConflictEditorState,
  getLocalAdeCheckpointRestorePlan,
  getLocalAdeCheckpointVisualMergeState,
  getLocalAdeOperationSummary,
  getLocalAdeRunActions,
  getLocalAdeSessionCockpitState,
  getLocalAdeWorkbenchState,
  getLocalAdeWorkspaceFocus,
  getLocalAdeWorkflowLanes,
  type LocalAdeAgentLaunchTarget,
  type LocalAdeRunAction,
  type LocalAdeCommandDeckPanel,
  type LocalAdeSessionCockpitState,
  type LocalAdeWorkbenchCommand,
  type LocalAdeWorkspaceFocusItem,
  type LocalAdeWorkflowLane,
} from "./local-ade-operations";

type RouterOutput = inferRouterOutputs<AppRouter>;
type LocalAdeSnapshot = RouterOutput["settings"]["getLocalAdeSnapshot"];
type Capability = LocalAdeSnapshot["capabilities"]["capabilities"][number];
type CheckpointPreview = RouterOutput["settings"]["previewCheckpoint"];
type McpInvocationResult = RouterOutput["settings"]["invokeMcpTool"];
type AcpActivityReplay = RouterOutput["settings"]["replayAcpActivity"];
type CheckpointHunkSelection = { file: string; hunkIndex: number };
type McpTransport = "stdio" | "sse" | "streamable-http";
type AuditReviewState = "all" | "open" | "reviewed";
type ExecutionPolicyPreset = "standard" | "restricted" | "blocked";
type HookLifecycleFailureMode = "continue" | "stop-on-failure";
type McpRemoteControlDraft = {
  requestTimeoutMs: string;
  reconnectAttempts: string;
  notificationWatchMs: string;
};

const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 3500;
const DEFAULT_MCP_RECONNECT_ATTEMPTS = 1;
const DEFAULT_MCP_NOTIFICATION_WATCH_MS = 1000;

interface LocalAdeControlCenterProps {
  className?: string;
  compact?: boolean;
  onStartSession?: (agentId?: string) => void;
  onOpenSession?: (chatId: string) => void;
  onSubmitCommand?: (command: string, chatId?: string) => void | Promise<void>;
  showHeader?: boolean;
  visibleSections?: readonly LocalAdeControlCenterSection[];
}

export type LocalAdeControlCenterSection =
  | "overview"
  | "runtime"
  | "providers"
  | "capabilities"
  | "hooks"
  | "plugins"
  | "memory"
  | "mcp"
  | "project-index"
  | "activity"
  | "storage";

const LOCAL_ADE_CONTROL_CENTER_SECTIONS: readonly LocalAdeControlCenterSection[] = [
  "overview",
  "runtime",
  "providers",
  "capabilities",
  "hooks",
  "plugins",
  "memory",
  "mcp",
  "project-index",
  "activity",
  "storage",
];

const CAPABILITY_ORDER = [
  "skill",
  "command",
  "output-style",
  "model-provider",
  "mcp-server",
  "subagent",
  "hook",
  "plugin",
] as const;

const HOOK_EVENT_OPTIONS = [
  { value: "manual", label: "manual" },
  { value: "after-agent-session-create", label: "after-agent-session-create" },
  { value: "after-agent-message-send", label: "after-agent-message-send" },
  { value: "after-agent-session-stop", label: "after-agent-session-stop" },
  { value: "after-project-index-refresh", label: "after-project-index-refresh" },
  { value: "after-checkpoint-create", label: "after-checkpoint-create" },
  { value: "after-checkpoint-restore", label: "after-checkpoint-restore" },
] as const;

const AUDIT_REVIEW_FILTERS: Array<{ value: AuditReviewState; label: string }> = [
  { value: "all", label: "all" },
  { value: "open", label: "open" },
  { value: "reviewed", label: "reviewed" },
];

const HOOK_LIFECYCLE_FAILURE_MODE_OPTIONS: Array<{
  value: HookLifecycleFailureMode;
  label: string;
}> = [
  { value: "continue", label: "continue" },
  { value: "stop-on-failure", label: "stop-on-failure" },
];

const AUTOMATION_PARALLEL_OPTIONS = ["1", "2", "3", "4"] as const;
const AUTOMATION_COOLDOWN_OPTIONS = [
  { value: "0", label: "off" },
  { value: "5000", label: "5s" },
  { value: "30000", label: "30s" },
  { value: "300000", label: "5m" },
  { value: "600000", label: "10m" },
] as const;
const PLUGIN_BATCH_SCHEDULE_INTERVAL_OPTIONS = [
  { value: "60000", label: "1m" },
  { value: "300000", label: "5m" },
  { value: "900000", label: "15m" },
  { value: "3600000", label: "1h" },
] as const;

const EXECUTION_POLICY_PRESET_OPTIONS: Array<{
  value: ExecutionPolicyPreset;
  label: string;
}> = [
  { value: "standard", label: "standard" },
  { value: "restricted", label: "restricted" },
  { value: "blocked", label: "blocked" },
];

function matchesAuditReviewState(
  reviewedAt: string | undefined,
  state: AuditReviewState
): boolean {
  if (state === "reviewed") {
    return Boolean(reviewedAt);
  }
  if (state === "open") {
    return !reviewedAt;
  }
  return true;
}

async function copyJsonToClipboard(value: unknown, successMessage: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    toast.error("Clipboard unavailable");
    return;
  }
  await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
  toast.success(successMessage);
}

function formatBytes(value: number | undefined): string {
  if (typeof value !== "number") {
    return "n/a";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: string | number | undefined): string {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusVariant(
  value: string | boolean | undefined
): "default" | "secondary" | "destructive" | "outline" {
  if (
    value === true ||
    value === "ready" ||
    value === "available" ||
    value === "success" ||
    value === "trusted" ||
    value === "granted" ||
    value === "approved" ||
    value === "added" ||
    value === "ok" ||
    value === "allowed" ||
    value === "injectable" ||
    value === "selected" ||
    value === "installable" ||
    value === "installed" ||
    value === "valid" ||
    value === "verified" ||
    value === "due" ||
    value === "active" ||
    value === "healthy"
  ) {
    return "default";
  }
  if (
    value === false ||
    value === "error" ||
    value === "blocked" ||
    value === "unavailable" ||
    value === "invalid-config" ||
    value === "failed" ||
    value === "missing" ||
    value === "missing-cli" ||
    value === "changed" ||
    value === "deleted" ||
    value === "revoked" ||
    value === "timeout" ||
    value === "expired" ||
    value === "verification-failed" ||
    value === "stale-fingerprint" ||
    value === "stale"
  ) {
    return "destructive";
  }
  if (
    value === "partial" ||
    value === "degraded" ||
    value === "warning" ||
    value === "untrusted" ||
    value === "modified" ||
    value === "renamed" ||
    value === "missing-config" ||
    value === "disabled" ||
    value === "paused" ||
    value === "cooldown" ||
    value === "parallel-limit" ||
    value === "cli-ok" ||
    value === "auth-unknown" ||
    value === "model-unknown" ||
    value === "unknown" ||
    value === "unsupported" ||
    value === "attention" ||
    value === "update-available" ||
    value === "consumed" ||
    value === "setup" ||
    value === "standby" ||
    value === "needs-probe"
  ) {
    return "secondary";
  }
  if (value === "running") {
    return "default";
  }
  if (
    value === "conditional" ||
    value === "skipped" ||
    value === "not-declared" ||
    value === "not-applicable"
  ) {
    return "outline";
  }
  return "outline";
}

function shortPath(value: string | undefined): string {
  if (!value) {
    return "not configured";
  }
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length <= 4) {
    return normalized;
  }
  return `.../${parts.slice(-3).join("/")}`;
}

function shortId(value: string | undefined): string {
  if (!value) {
    return "n/a";
  }
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function diffRowClass(kind: string): string {
  if (kind === "add") {
    return "bg-emerald-500/5";
  }
  if (kind === "delete") {
    return "bg-red-500/5";
  }
  if (kind === "change") {
    return "bg-amber-500/5";
  }
  return "";
}

function diffCellClass(kind: string, side: "old" | "new"): string {
  if (kind === "add" && side === "new") {
    return "text-emerald-700 dark:text-emerald-300";
  }
  if (kind === "delete" && side === "old") {
    return "text-red-700 dark:text-red-300";
  }
  if (kind === "change") {
    return side === "old"
      ? "text-red-700 dark:text-red-300"
      : "text-emerald-700 dark:text-emerald-300";
  }
  if (kind === "meta") {
    return "text-muted-foreground italic";
  }
  return "";
}

function checkpointMergeCellClass(tone: string): string {
  if (tone === "restore") {
    return "bg-emerald-500/5 text-emerald-700 dark:text-emerald-300";
  }
  if (tone === "current") {
    return "bg-red-500/5 text-red-700 dark:text-red-300";
  }
  if (tone === "changed") {
    return "bg-amber-500/5 text-amber-700 dark:text-amber-300";
  }
  if (tone === "meta") {
    return "text-muted-foreground italic";
  }
  if (tone === "empty") {
    return "bg-muted/30 text-muted-foreground";
  }
  return "";
}

function checkpointHunkSelectionKey(selection: CheckpointHunkSelection): string {
  return `${selection.file}:${selection.hunkIndex}`;
}

function parseMcpHeaderEnvText(value: string): Record<string, string> | undefined {
  const entries = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [header, ...rest] = line.split("=");
      return [header?.trim() ?? "", rest.join("=").trim()] as const;
    })
    .filter(([header, envKey]) => header && envKey);
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries);
}

function parseJsonRecordText(value: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MCP tool args must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function parseHookArgsText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEnvKeysText(value: string): string[] {
  return [...new Set(parseHookArgsText(value))].filter((item) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(item)
  );
}

function parseIdentifierListText(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\r\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

function isUnavailableCapability(item: Capability): boolean {
  const diagnostics = (item.diagnostics ?? []).join(" ").toLowerCase();
  return (
    item.id.includes(".unavailable") ||
    diagnostics.includes("unavailable") ||
    diagnostics.includes("not implemented") ||
    diagnostics.includes("intentionally blocked")
  );
}

function Section({
  title,
  icon: Icon,
  children,
  action,
  id,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
}) {
  return (
    <section className="rounded-md border bg-background" id={id}>
      <div className="flex min-h-11 items-center justify-between gap-3 border-b px-3 py-2">
        <h3 className="flex min-w-0 items-center gap-2 font-medium text-sm">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{title}</span>
        </h3>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function scrollToLocalAdeSection(id: string): void {
  if (typeof document === "undefined") {
    return;
  }
  document.getElementById(id)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function WorkflowActionButton({
  icon: Icon,
  label,
  detail,
  onClick,
  disabled,
  primary,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Button
      className="h-auto min-h-14 justify-start whitespace-normal px-2.5 py-2 text-left"
      disabled={disabled}
      onClick={onClick}
      size="sm"
      variant={primary ? "default" : "outline"}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-xs">{label}</span>
        <span className="mt-0.5 block truncate text-[11px] opacity-75">
          {detail}
        </span>
      </span>
    </Button>
  );
}

function workflowLaneToneClass(tone: LocalAdeWorkflowLane["tone"]): string {
  if (tone === "ready") {
    return "border-l-primary";
  }
  if (tone === "warning") {
    return "border-l-amber-500";
  }
  if (tone === "blocked") {
    return "border-l-destructive";
  }
  if (tone === "idle") {
    return "border-l-muted-foreground/40";
  }
  return "border-l-border";
}

function workflowLaneBadgeValue(tone: LocalAdeWorkflowLane["tone"]): string {
  if (tone === "ready") {
    return "ready";
  }
  if (tone === "warning") {
    return "warning";
  }
  if (tone === "blocked") {
    return "blocked";
  }
  if (tone === "idle") {
    return "idle";
  }
  return "unknown";
}

function WorkflowLane({ lane }: { lane: LocalAdeWorkflowLane }) {
  return (
    <div className={cn("min-w-0 border-l-2 py-1 pl-2", workflowLaneToneClass(lane.tone))}>
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="truncate font-medium text-xs">{lane.label}</span>
        <Badge
          className="h-4 px-1.5 text-[10px]"
          variant={statusVariant(workflowLaneBadgeValue(lane.tone))}
        >
          {workflowLaneBadgeValue(lane.tone)}
        </Badge>
      </div>
      <div className="mt-1 truncate font-semibold text-sm">{lane.value}</div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {lane.detail}
      </div>
    </div>
  );
}

function WorkspaceFocusItem({ item }: { item: LocalAdeWorkspaceFocusItem }) {
  return (
    <div className={cn("min-w-0 border-l-2 py-1 pl-2", workflowLaneToneClass(item.tone))}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-muted-foreground text-[11px] uppercase">
          {item.label}
        </span>
        <Badge
          className="h-4 px-1.5 text-[10px]"
          variant={statusVariant(workflowLaneBadgeValue(item.tone))}
        >
          {workflowLaneBadgeValue(item.tone)}
        </Badge>
      </div>
      <div className="mt-1 truncate font-semibold text-sm">{item.value}</div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {item.detail}
      </div>
    </div>
  );
}

function runActionIcon(action: LocalAdeRunAction) {
  if (action.id === "session") {
    return Terminal;
  }
  if (action.id === "provider") {
    return TestTube2;
  }
  if (action.id === "mcp") {
    return PlugZap;
  }
  if (action.id === "checkpoint") {
    return Undo2;
  }
  if (action.id === "index") {
    return Database;
  }
  if (action.id === "memory") {
    return FileText;
  }
  return action.action === "copy-command" ? Copy : MessageSquare;
}

function RunActionCard({
  action,
  onRun,
  busy,
}: {
  action: LocalAdeRunAction;
  onRun: (action: LocalAdeRunAction) => void;
  busy?: boolean;
}) {
  const Icon = runActionIcon(action);
  return (
    <Button
      className={cn(
        "h-auto min-h-16 justify-start whitespace-normal border-l-2 px-2.5 py-2 text-left",
        workflowLaneToneClass(action.tone)
      )}
      disabled={!action.enabled || busy}
      onClick={() => onRun(action)}
      size="sm"
      type="button"
      variant="outline"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium text-xs">{action.label}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {action.value}
          </span>
        </span>
        <span className="mt-1 block truncate text-[11px] text-muted-foreground">
          {action.detail}
        </span>
      </span>
    </Button>
  );
}

function WorkbenchCommandButton({
  command,
  onCopy,
}: {
  command: LocalAdeWorkbenchCommand;
  onCopy: (command: string) => void;
}) {
  return (
    <Button
      className="h-8 justify-start gap-2 px-2 text-left"
      onClick={() => onCopy(command.command)}
      size="sm"
      type="button"
      variant="outline"
    >
      <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate font-mono text-[11px]">
        {command.command}
      </span>
    </Button>
  );
}

function CommandDeckPanel({ panel }: { panel: LocalAdeCommandDeckPanel }) {
  return (
    <div
      className={cn(
        "min-w-0 border-l-2 py-1 pl-3",
        workflowLaneToneClass(panel.tone)
      )}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="truncate text-[11px] text-muted-foreground uppercase">
          {panel.label}
        </span>
        <Badge
          className="h-4 px-1.5 text-[10px]"
          variant={statusVariant(workflowLaneBadgeValue(panel.tone))}
        >
          {workflowLaneBadgeValue(panel.tone)}
        </Badge>
      </div>
      <div className="mt-1 truncate font-semibold text-sm">{panel.value}</div>
      <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
        {panel.detail}
      </div>
    </div>
  );
}

function CommandDeckActionButton({
  action,
  busy,
  onRun,
  primary,
}: {
  action: LocalAdeRunAction;
  busy?: boolean;
  onRun: (action: LocalAdeRunAction) => void;
  primary?: boolean;
}) {
  const Icon = runActionIcon(action);
  return (
    <Button
      className={cn(
        "h-auto justify-start gap-2 whitespace-normal text-left",
        primary ? "min-h-14 px-3 py-2" : "min-h-9 px-2 py-1.5"
      )}
      disabled={!action.enabled || busy}
      onClick={() => onRun(action)}
      size="sm"
      type="button"
      variant={primary && action.tone === "ready" ? "default" : "outline"}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium text-xs">{action.label}</span>
          <span className="shrink-0 text-[10px] opacity-70">{action.value}</span>
        </span>
        {primary ? (
          <span className="mt-1 block truncate text-[11px] opacity-75">
            {action.detail}
          </span>
        ) : null}
      </span>
    </Button>
  );
}

function AgentLaunchSelector({
  targets,
  onStartSession,
}: {
  targets: LocalAdeAgentLaunchTarget[];
  onStartSession?: (agentId?: string) => void;
}) {
  const preferredTargetId =
    targets.find((target) => target.isActive && target.canStart)?.agentId ??
    targets.find((target) => target.canStart)?.agentId ??
    targets[0]?.agentId ??
    "";
  const [selectedAgentId, setSelectedAgentId] =
    React.useState(preferredTargetId);
  const selectedTarget =
    targets.find((target) => target.agentId === selectedAgentId) ?? targets[0];
  const readyCount = targets.filter((target) => target.canStart).length;

  React.useEffect(() => {
    if (
      preferredTargetId &&
      (!selectedAgentId ||
        !targets.some((target) => target.agentId === selectedAgentId))
    ) {
      setSelectedAgentId(preferredTargetId);
    }
  }, [preferredTargetId, selectedAgentId, targets]);

  if (targets.length === 0) {
    return (
      <Button
        disabled={!onStartSession}
        onClick={() => onStartSession?.()}
        size="sm"
        type="button"
        variant="default"
      >
        <Terminal className="mr-2 h-4 w-4" />
        Start Session
      </Button>
    );
  }

  return (
    <div className="grid gap-2 rounded-md border bg-muted/10 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-xs">Agent Launch</span>
        <Badge variant={readyCount > 0 ? "default" : "secondary"}>
          {readyCount}/{targets.length} startable
        </Badge>
      </div>
      <Select onValueChange={setSelectedAgentId} value={selectedTarget?.agentId}>
        <SelectTrigger className="h-8">
          <SelectValue placeholder="Select agent" />
        </SelectTrigger>
        <SelectContent>
          {targets.map((target) => (
            <SelectItem key={target.agentId} value={target.agentId}>
              {target.label} / {target.status}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedTarget ? (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <Badge variant={statusVariant(selectedTarget.status)}>
              {selectedTarget.status}
            </Badge>
            <Badge variant="outline">{selectedTarget.type}</Badge>
            {selectedTarget.version ? (
              <Badge variant="outline">{selectedTarget.version}</Badge>
            ) : null}
          </div>
          <div
            className="mt-1 truncate text-[11px] text-muted-foreground"
            title={selectedTarget.detail}
          >
            {selectedTarget.detail}
          </div>
        </div>
      ) : null}
      <Button
        disabled={!onStartSession || !selectedTarget?.canStart}
        onClick={() => onStartSession?.(selectedTarget?.agentId)}
        size="sm"
        type="button"
        variant={selectedTarget?.canStart ? "default" : "outline"}
      >
        <Terminal className="mr-2 h-4 w-4" />
        Start
      </Button>
    </div>
  );
}

function SessionCockpit({
  cockpit,
  onCopyCommand,
  onInspectSession,
  onOpenSession,
  onStartSession,
  onSubmitCommand,
}: {
  cockpit: LocalAdeSessionCockpitState;
  onCopyCommand: (command: string) => void;
  onInspectSession: () => void;
  onOpenSession?: (chatId: string) => void;
  onStartSession?: (agentId?: string) => void;
  onSubmitCommand?: (command: string, chatId?: string) => void | Promise<void>;
}) {
  const primarySession = cockpit.primarySession;
  const launchOptions = cockpit.launchOptions;
  const [selectedLaunchId, setSelectedLaunchId] = React.useState<string>(
    launchOptions[0]?.id ?? ""
  );
  const [launchArgument, setLaunchArgument] = React.useState("");
  const selectedLaunchOption =
    launchOptions.find((option) => option.id === selectedLaunchId) ??
    launchOptions[0];

  React.useEffect(() => {
    if (
      launchOptions.length > 0 &&
      !launchOptions.some((option) => option.id === selectedLaunchId)
    ) {
      setSelectedLaunchId(launchOptions[0]?.id ?? "");
    }
  }, [launchOptions, selectedLaunchId]);

  const handleLaunchCommand = React.useCallback(() => {
    if (!selectedLaunchOption) {
      return;
    }
    const result = buildLocalAdeCommandLaunchText({
      option: selectedLaunchOption,
      argument: launchArgument,
    });
    if (result.status === "missing-argument") {
      toast.error(result.message);
      return;
    }
    if (onSubmitCommand) {
      void Promise.resolve(
        onSubmitCommand(result.text, primarySession?.id)
      ).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Command launch failed");
      });
      setLaunchArgument("");
      return;
    }
    void onCopyCommand(result.text);
  }, [
    launchArgument,
    onCopyCommand,
    onSubmitCommand,
    primarySession?.id,
    selectedLaunchOption,
  ]);

  return (
    <div className="border-t bg-background p-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(cockpit.mode)}>
              {cockpit.mode}
            </Badge>
            <Badge variant="outline">{cockpit.activeCount} active</Badge>
            <Badge variant="outline">
              {cockpit.totalStored ?? "n/a"} stored
            </Badge>
          </div>
          <div className="mt-2 font-semibold text-sm">{cockpit.headline}</div>
          <div className="mt-1 truncate text-muted-foreground text-xs">
            {cockpit.detail}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="min-w-0">
              <div className="text-[11px] text-muted-foreground uppercase">
                Permissions
              </div>
              <div className="mt-1 font-semibold text-sm">
                {cockpit.pendingPermissions}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-muted-foreground uppercase">
                Tool Calls
              </div>
              <div className="mt-1 font-semibold text-sm">
                {cockpit.activeToolCalls}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-muted-foreground uppercase">
                Subscribers
              </div>
              <div className="mt-1 font-semibold text-sm">
                {cockpit.subscribers}
              </div>
            </div>
          </div>
        </div>
        <div className="grid content-start gap-2">
          {primarySession ? (
            <>
              <div className="rounded-md border bg-muted/20 p-2">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium text-xs">
                    {primarySession.label}
                  </span>
                  <Badge variant={statusVariant(workflowLaneBadgeValue(primarySession.tone))}>
                    {primarySession.status}
                  </Badge>
                </div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  {primarySession.detail}
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {primarySession.model}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={() => {
                    if (onOpenSession) {
                      onOpenSession(primarySession.id);
                    } else {
                      onInspectSession();
                    }
                  }}
                  size="sm"
                  type="button"
                  variant="default"
                >
                  <MessageSquare className="mr-2 h-4 w-4" />
                  {onOpenSession ? "Open Chat" : "Inspect"}
                </Button>
                <Button
                  onClick={onInspectSession}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Runtime
                </Button>
              </div>
            </>
          ) : (
            <AgentLaunchSelector
              onStartSession={onStartSession}
              targets={cockpit.agentLaunchTargets}
            />
          )}
          {primarySession ? (
            <AgentLaunchSelector
              onStartSession={onStartSession}
              targets={cockpit.agentLaunchTargets}
            />
          ) : null}
          {cockpit.commands.length > 0 ? (
            <div className="grid gap-2">
              {cockpit.commands.slice(0, 2).map((command) => (
                <WorkbenchCommandButton
                  command={command}
                  key={command.id}
                  onCopy={onCopyCommand}
                />
              ))}
            </div>
          ) : null}
          {launchOptions.length > 0 ? (
            <div className="grid gap-2 rounded-md border bg-muted/10 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-xs">Command Launcher</span>
                <Badge variant={onSubmitCommand ? "default" : "outline"}>
                  {onSubmitCommand ? "chat" : "copy"}
                </Badge>
              </div>
              <Select
                onValueChange={(value) => {
                  setSelectedLaunchId(value);
                  setLaunchArgument("");
                }}
                value={selectedLaunchOption?.id ?? ""}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {launchOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.baseCommand}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Input
                  className="h-8"
                  onChange={(event) => setLaunchArgument(event.target.value)}
                  placeholder={
                    selectedLaunchOption?.requiresArgument
                      ? selectedLaunchOption.argumentHint
                      : "optional request"
                  }
                  value={launchArgument}
                />
                <Button
                  disabled={!selectedLaunchOption}
                  onClick={handleLaunchCommand}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Play className="mr-2 h-4 w-4" />
                  {onSubmitCommand ? "Run" : "Copy"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {cockpit.sessions.length > 1 ? (
        <div className="mt-3 grid gap-2 xl:grid-cols-2">
          {cockpit.sessions.slice(1, 5).map((session) => (
            <button
              className={cn(
                "min-w-0 rounded-md border-l-2 bg-muted/10 px-2 py-1.5 text-left hover:bg-muted/30",
                workflowLaneToneClass(session.tone)
              )}
              key={session.id}
              onClick={() => {
                if (onOpenSession) {
                  onOpenSession(session.id);
                } else {
                  onInspectSession();
                }
              }}
              type="button"
            >
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate font-medium text-xs">{session.label}</span>
                <Badge variant={statusVariant(workflowLaneBadgeValue(session.tone))}>
                  {session.status}
                </Badge>
              </span>
              <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                {session.detail}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorkflowActionStrip({
  diagnostics,
  snapshot,
  onOpenSession,
  onStartSession,
  onSubmitCommand,
  onRefreshRuntime,
  onTestProviders,
  onProbeMcp,
  onCreateCheckpoint,
  onRefreshIndex,
  onCopyCommand,
  isRefreshing,
  isTestingProviders,
  isProbingMcp,
  isCreatingCheckpoint,
  isRefreshingIndex,
}: {
  diagnostics: RuntimeDiagnostics | null;
  snapshot: LocalAdeSnapshot | undefined;
  onStartSession?: (agentId?: string) => void;
  onOpenSession?: (chatId: string) => void;
  onSubmitCommand?: (command: string, chatId?: string) => void | Promise<void>;
  onRefreshRuntime: () => void;
  onTestProviders: () => void;
  onProbeMcp: () => void;
  onCreateCheckpoint: () => void;
  onRefreshIndex: () => void;
  onCopyCommand: (command: string) => void;
  isRefreshing?: boolean;
  isTestingProviders?: boolean;
  isProbingMcp?: boolean;
  isCreatingCheckpoint?: boolean;
  isRefreshingIndex?: boolean;
}) {
  const summary = getLocalAdeOperationSummary({ diagnostics, snapshot });
  const providerDetail =
    summary.providers.total === 0
      ? "0 providers"
      : `${summary.providers.ready}/${summary.providers.total} ready`;
  const mcpDetail =
    summary.mcp.totalEnabled === 0
      ? "0 enabled"
      : `${summary.mcp.initialized}/${summary.mcp.totalEnabled} initialized${
          summary.mcp.failed > 0 ? `, ${summary.mcp.failed} failed` : ""
        }`;
  const checkpointDetail = summary.checkpoint.canCreate
    ? `${summary.checkpoint.changedFiles} changed / ${summary.checkpoint.count} saved`
    : "not a git repo";
  const workspaceFocus = getLocalAdeWorkspaceFocus({ diagnostics, snapshot });
  const lanes = getLocalAdeWorkflowLanes({ diagnostics, snapshot });
  const runActions = getLocalAdeRunActions({ diagnostics, snapshot });
  const workbench = getLocalAdeWorkbenchState({ diagnostics, snapshot });
  const commandDeck = getLocalAdeCommandDeckState({ diagnostics, snapshot });
  const sessionCockpit = getLocalAdeSessionCockpitState({ diagnostics, snapshot });
  const handleRunAction = React.useCallback(
    (action: LocalAdeRunAction) => {
      if (action.action === "start-session") {
        onStartSession?.();
        return;
      }
      if (action.action === "probe-providers") {
        onTestProviders();
        return;
      }
      if (action.action === "probe-mcp") {
        onProbeMcp();
        return;
      }
      if (action.action === "create-checkpoint") {
        onCreateCheckpoint();
        return;
      }
      if (action.action === "refresh-index") {
        onRefreshIndex();
        return;
      }
      if (action.action === "copy-command" && action.command) {
        onCopyCommand(action.command);
        return;
      }
      if (action.targetSection) {
        scrollToLocalAdeSection(action.targetSection);
      }
    },
    [
      onCopyCommand,
      onCreateCheckpoint,
      onProbeMcp,
      onRefreshIndex,
      onStartSession,
      onTestProviders,
    ]
  );
  const isActionBusy = React.useCallback(
    (action: LocalAdeRunAction) =>
      (action.action === "probe-providers" && isTestingProviders) ||
      (action.action === "probe-mcp" && isProbingMcp) ||
      (action.action === "create-checkpoint" && isCreatingCheckpoint) ||
      (action.action === "refresh-index" && isRefreshingIndex),
    [isCreatingCheckpoint, isProbingMcp, isRefreshingIndex, isTestingProviders]
  );

  return (
    <div className="rounded-md border bg-background">
      <div className="border-b bg-muted/20 p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(commandDeck.status)}>
                {commandDeck.status}
              </Badge>
              <Badge variant="outline">{workbench.score}</Badge>
            </div>
            <div className="mt-2 font-semibold text-base">
              {commandDeck.headline}
            </div>
            <div className="mt-1 truncate text-muted-foreground text-xs">
              {commandDeck.detail} / {diagnostics?.endpoint.kind ?? "desktop-service"} /{" "}
              {shortPath(snapshot?.projectRoot)}
            </div>
          </div>
          <div className="flex flex-wrap items-start justify-start gap-1 lg:justify-end">
            <Badge variant={statusVariant(summary.runtimeState)}>
              runtime {summary.runtimeState}
            </Badge>
            <Badge variant="outline">{summary.providers.ready} providers ready</Badge>
            <Badge variant="outline">{summary.mcp.agentBrokered} brokered MCP</Badge>
          </div>
        </div>
        <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
            {commandDeck.panels.map((panel) => (
              <CommandDeckPanel key={panel.id} panel={panel} />
            ))}
          </div>
          <div className="grid content-start gap-2">
            {commandDeck.primaryAction ? (
              <CommandDeckActionButton
                action={commandDeck.primaryAction}
                busy={isActionBusy(commandDeck.primaryAction)}
                onRun={handleRunAction}
                primary
              />
            ) : null}
            {commandDeck.secondaryActions.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                {commandDeck.secondaryActions.slice(0, 3).map((action) => (
                  <CommandDeckActionButton
                    action={action}
                    busy={isActionBusy(action)}
                    key={action.id}
                    onRun={handleRunAction}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {commandDeck.commands.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {commandDeck.commands.map((command) => (
              <WorkbenchCommandButton
                command={command}
                key={command.id}
                onCopy={onCopyCommand}
              />
            ))}
          </div>
        ) : null}
      </div>
      <SessionCockpit
        cockpit={sessionCockpit}
        onCopyCommand={onCopyCommand}
        onInspectSession={() => scrollToLocalAdeSection("local-ade-runtime")}
        onOpenSession={onOpenSession}
        onStartSession={onStartSession}
        onSubmitCommand={onSubmitCommand}
      />
      <div className="grid gap-0 xl:grid-cols-[minmax(420px,0.95fr)_1.35fr]">
        <div className="border-b p-3 xl:border-r xl:border-b-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-sm">Workspace Run Loop</div>
              <div className="mt-1 truncate text-muted-foreground text-xs">
                {diagnostics?.endpoint.kind ?? "desktop-service"} / {shortPath(snapshot?.projectRoot)}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              <Badge variant={statusVariant(summary.runtimeState)}>
                runtime {summary.runtimeState}
              </Badge>
              <Badge variant="outline">{summary.activeSessions} active</Badge>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <WorkflowActionButton
              detail="new agent loop"
              disabled={!onStartSession}
              icon={Terminal}
              label="Start Session"
              onClick={() => onStartSession?.()}
              primary
            />
            <WorkflowActionButton
              detail={diagnostics?.endpoint.kind ?? "desktop-service"}
              disabled={isRefreshing}
              icon={Activity}
              label="Runtime"
              onClick={onRefreshRuntime}
            />
            <WorkflowActionButton
              detail={providerDetail}
              disabled={
                isTestingProviders || summary.providers.probeTargets.length === 0
              }
              icon={TestTube2}
              label="Providers"
              onClick={onTestProviders}
            />
            <WorkflowActionButton
              detail={mcpDetail}
              disabled={isProbingMcp || summary.mcp.totalEnabled === 0}
              icon={PlugZap}
              label="MCP"
              onClick={onProbeMcp}
            />
            <WorkflowActionButton
              detail={checkpointDetail}
              disabled={!summary.checkpoint.canCreate || isCreatingCheckpoint}
              icon={Undo2}
              label="Checkpoint"
              onClick={onCreateCheckpoint}
            />
            <WorkflowActionButton
              detail={summary.subagentCommand ?? "none enabled"}
              disabled={!summary.subagentCommand}
              icon={summary.subagentCommand ? Copy : MessageSquare}
              label="Subagent"
              onClick={() => {
                if (summary.subagentCommand) {
                  onCopyCommand(summary.subagentCommand);
                }
              }}
            />
          </div>
          <div className="mt-3 border-t pt-3">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="font-semibold text-sm">Next Actions</div>
              <Badge variant="outline">{runActions.length} routed</Badge>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {runActions.map((action) => (
                <RunActionCard
                  action={action}
                  busy={isActionBusy(action)}
                  key={action.id}
                  onRun={handleRunAction}
                />
              ))}
            </div>
          </div>
          <div className="mt-3 border-t pt-3">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-sm">{workspaceFocus.title}</div>
                <div className="mt-1 truncate text-muted-foreground text-xs">
                  {workspaceFocus.subtitle}
                </div>
              </div>
              <Badge variant={statusVariant(workspaceFocus.items[0]?.tone)}>
                {workspaceFocus.items[0]?.value ?? "unknown"}
              </Badge>
            </div>
            <div className="mt-3 grid gap-x-3 gap-y-2 sm:grid-cols-2">
              {workspaceFocus.items.map((item) => (
                <WorkspaceFocusItem item={item} key={item.id} />
              ))}
            </div>
          </div>
        </div>
        <div className="p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-sm">Workflow Readiness</div>
              <div className="mt-1 truncate text-muted-foreground text-xs">
                {summary.providers.ready}/{summary.providers.total} providers,{" "}
                {summary.mcp.initialized}/{summary.mcp.totalEnabled} MCP
              </div>
            </div>
            <Badge variant={statusVariant(snapshot?.capabilities.diagnostics.status)}>
              {snapshot?.capabilities.diagnostics.enabledCount ?? 0} enabled
            </Badge>
          </div>
          <div className="mt-3 grid gap-x-3 gap-y-2 sm:grid-cols-2 2xl:grid-cols-3">
            {lanes.map((lane) => (
              <WorkflowLane key={lane.id} lane={lane} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="min-w-0 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 truncate font-semibold text-sm">{value}</div>
      {detail ? (
        <div className="mt-1 truncate text-muted-foreground text-xs">{detail}</div>
      ) : null}
    </div>
  );
}

type BackgroundTask =
  NonNullable<LocalAdeSnapshot["runtime"]["background"]>["tasks"][number];
type BackgroundTaskResult = BackgroundTask["lastResult"];

function backgroundTaskStatus(
  task: BackgroundTask
): "running" | "failed" | "success" | "idle" {
  if (task.running) {
    return "running";
  }
  if (task.failureCount > 0 && task.failureCount >= task.successCount) {
    return "failed";
  }
  if (task.successCount > 0) {
    return "success";
  }
  return "idle";
}

function backgroundTaskResultText(result: BackgroundTaskResult): string {
  if (!result) {
    return "no result";
  }
  const entries = Object.entries(result)
    .filter(([, value]) => value !== null && value !== undefined)
    .slice(0, 4);
  if (entries.length === 0) {
    return "empty result";
  }
  return entries.map(([key, value]) => `${key}:${String(value)}`).join(" / ");
}

function BackgroundTaskFleet({
  snapshot,
}: {
  snapshot: LocalAdeSnapshot | undefined;
}) {
  const background = snapshot?.runtime.background;
  const tasks = background?.tasks ?? [];
  const summary = getLocalAdeBackgroundSummary(snapshot);

  if (!background) {
    return (
      <div className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
        Background runner state is not reported yet.
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <div className="font-medium text-sm">Background Task Fleet</div>
          <div className="truncate text-muted-foreground text-xs">
            {summary.running} running / {summary.succeeded} succeeded /{" "}
            {summary.failed} failed
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={statusVariant(background.enabled ? "ready" : "disabled")}>
            {background.enabled ? "enabled" : "disabled"}
          </Badge>
          <span className="text-muted-foreground">
            tick {background.tickMs}ms
            {background.startedAt ? ` / started ${formatTime(background.startedAt)}` : ""}
          </span>
        </div>
      </div>
      {tasks.length > 0 ? (
        <div className="divide-y">
          {tasks.map((task) => {
            const status = backgroundTaskStatus(task);
            return (
              <div
                className="grid gap-2 px-3 py-2 text-xs sm:grid-cols-[minmax(0,1.2fr)_90px_120px_minmax(0,1fr)]"
                key={task.name}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-sm">{task.name}</div>
                  <div className="truncate text-muted-foreground">
                    every {task.intervalMs}ms / timeout {task.timeoutMs}ms
                  </div>
                </div>
                <div className="flex items-start sm:justify-center">
                  <Badge variant={statusVariant(status)}>{status}</Badge>
                </div>
                <div className="text-muted-foreground">
                  <div>{task.successCount} ok</div>
                  <div>{task.failureCount} failed</div>
                </div>
                <div className="min-w-0 text-muted-foreground">
                  <div className="truncate">
                    {task.lastDurationMs !== undefined
                      ? `${task.lastDurationMs}ms`
                      : "no duration"}{" "}
                    / {formatTime(task.lastFinishedAt ?? task.lastStartedAt)}
                  </div>
                  <div className="truncate" title={task.lastError ?? backgroundTaskResultText(task.lastResult)}>
                    {task.lastError ?? backgroundTaskResultText(task.lastResult)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-3 py-3 text-muted-foreground text-sm">
          No background tasks registered.
        </div>
      )}
    </div>
  );
}

function RuntimeStrip({
  diagnostics,
  snapshot,
}: {
  diagnostics: RuntimeDiagnostics | null;
  snapshot: LocalAdeSnapshot | undefined;
}) {
  const desktopBootstrap = useServerConfigStore((state) => state.desktopBootstrap);
  const transport = desktopBootstrap?.transport.kind ?? "unknown";
  const endpoint = diagnostics?.endpoint.kind ?? "desktop-service";
  const chain =
    transport === "electron-ipc"
      ? `${transport} -> ${endpoint}`
      : `${transport} / ${endpoint}`;
  const backgroundSummary = getLocalAdeBackgroundSummary(snapshot);
  const dispatch = backgroundSummary.pluginBatchDispatch;
  const backgroundDetail = dispatch
    ? `batch ${dispatch.status}; ${dispatch.dispatchedSchedules ?? 0}/${dispatch.dueSchedules ?? 0} dispatched`
    : backgroundSummary.enabled
      ? `${backgroundSummary.succeeded}/${backgroundSummary.taskCount} succeeded`
      : "not reported";
  const backgroundStatus =
    !backgroundSummary.enabled
      ? "unknown"
      : backgroundSummary.failed > 0
        ? "warning"
        : backgroundSummary.running > 0
          ? "running"
          : "ready";
  const securityPosture = diagnostics?.securityPosture;
  const securityDetail = securityPosture
    ? [
        securityPosture.contentSecurityPolicy,
        securityPosture.contextIsolation ? "isolated" : "shared",
        securityPosture.nodeIntegration ? "node on" : "node off",
        securityPosture.endpointNetworkExposed ? "network" : "private",
      ].join(" / ")
    : "not reported";

  return (
    <div className="grid gap-2">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <StatTile
          detail={diagnostics?.health.message ?? "Waiting for runtime diagnostics"}
          icon={Activity}
          label="Runtime Health"
          value={
            <Badge variant={statusVariant(diagnostics?.health.state)}>
              {diagnostics?.health.state ?? "unknown"}
            </Badge>
          }
        />
        <StatTile
          detail={diagnostics?.endpoint.description}
          icon={ServerCog}
          label="Desktop Transport"
          value={chain}
        />
        <StatTile
          detail={securityDetail}
          icon={ShieldAlert}
          label="Security Posture"
          value={
            <Badge variant={statusVariant(securityPosture?.status)}>
              {securityPosture?.status ?? "unknown"}
            </Badge>
          }
        />
        <StatTile
          detail={`${snapshot?.sessions.totalStored ?? "n/a"} stored sessions`}
          icon={Bot}
          label="Active Sessions"
          value={snapshot?.sessions.active.length ?? 0}
        />
        <StatTile
          detail={`${snapshot?.capabilities.diagnostics.enabledCount ?? 0} enabled`}
          icon={SlidersHorizontal}
          label="Capabilities"
          value={snapshot?.capabilities.capabilities.length ?? 0}
        />
        <StatTile
          detail={backgroundDetail}
          icon={Activity}
          label="Background Tasks"
          value={
            <Badge variant={statusVariant(backgroundStatus)}>
              {backgroundSummary.taskCount}
            </Badge>
          }
        />
      </div>
      <BackgroundTaskFleet snapshot={snapshot} />
    </div>
  );
}

function CliGrid({ diagnostics }: { diagnostics: RuntimeDiagnostics | null }) {
  const clis = diagnostics?.cliAvailability ?? [];
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {clis.map((cli) => (
        <div className="rounded-md border p-3" key={cli.id}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium text-sm">{cli.displayName}</div>
              <div className="truncate text-muted-foreground text-xs">
                {cli.version ?? cli.command}
              </div>
            </div>
            {cli.available ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0 text-destructive" />
            )}
          </div>
          <div className="mt-2 truncate text-muted-foreground text-xs" title={cli.executablePath ?? cli.installHint}>
            {cli.executablePath ? shortPath(cli.executablePath) : cli.installHint}
          </div>
        </div>
      ))}
      {clis.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
          CLI diagnostics are not available yet.
        </div>
      ) : null}
    </div>
  );
}

function CapabilityRows({
  capabilities,
  onToggle,
  disabled,
}: {
  capabilities: Capability[];
  onToggle: (capability: Capability, enabled: boolean) => void;
  disabled?: boolean;
}) {
  const byKind = React.useMemo(() => {
    const map = new Map<string, Capability[]>();
    for (const capability of capabilities) {
      const group = map.get(capability.kind) ?? [];
      group.push(capability);
      map.set(capability.kind, group);
    }
    return map;
  }, [capabilities]);

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {CAPABILITY_ORDER.map((kind) => {
        const items = byKind.get(kind) ?? [];
        return (
          <div className="rounded-md border" key={kind}>
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="font-medium text-xs uppercase tracking-wide">
                {kind}
              </span>
              <Badge variant="outline">{items.length}</Badge>
            </div>
            <div className="max-h-60 overflow-y-auto p-2">
              {items.length === 0 ? (
                <div className="rounded border border-dashed p-3 text-muted-foreground text-xs">
                  No {kind} descriptors discovered.
                </div>
              ) : (
                items.map((item) => {
                  const unavailable = isUnavailableCapability(item);
                  return (
                    <div
                      className="flex items-start justify-between gap-3 rounded px-2 py-2 hover:bg-muted/40"
                      key={item.id}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-sm">
                            {item.name}
                          </span>
                          <Badge
                            variant={
                              unavailable
                                ? "secondary"
                                : item.enabled
                                  ? "default"
                                  : "outline"
                            }
                          >
                            {unavailable ? "unavailable" : item.enabled ? "enabled" : "off"}
                          </Badge>
                        </div>
                        <div className="mt-1 line-clamp-2 text-muted-foreground text-xs">
                          {item.description ?? item.diagnostics?.[0] ?? "No description"}
                        </div>
                        {item.sourcePath ? (
                          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={item.sourcePath}>
                            {shortPath(item.sourcePath)}
                          </div>
                        ) : null}
                      </div>
                      <Switch
                        checked={item.enabled}
                        disabled={disabled || unavailable}
                        onCheckedChange={(checked) => onToggle(item, checked)}
                        size="sm"
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProviderTable({ snapshot }: { snapshot: LocalAdeSnapshot | undefined }) {
  const utils = trpc.useUtils();
  const testProvider = trpc.settings.testProvider.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Provider probe completed");
    },
    onError: (error) => toast.error(error.message),
  });
  const selectProviderModel = trpc.settings.selectProviderModel.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Default model updated");
    },
    onError: (error) => toast.error(error.message),
  });
  const clearProviderModel = trpc.settings.clearProviderModel.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Default model cleared");
    },
    onError: (error) => toast.error(error.message),
  });
  const setActiveSessionModel = trpc.setModel.useMutation({
    onSuccess: () => {
      toast.success("Active session model updated");
      void utils.settings.getLocalAdeSnapshot.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const providers = snapshot?.providers ?? [];
  const activeModelSessions = (snapshot?.sessions.active ?? []).filter(
    (session) =>
      session.model.supportsSwitching || session.model.availableModels.length > 0
  );
  const defaultModel = snapshot?.runtime.defaultModel ?? "";
  const modelActionPending =
    selectProviderModel.isPending ||
    clearProviderModel.isPending ||
    setActiveSessionModel.isPending;
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2 text-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium">Runtime default model</span>
          {defaultModel ? (
            <Badge variant={statusVariant(snapshot?.runtime.defaultModelStatus)}>
              {defaultModel}
            </Badge>
          ) : (
            <span className="text-muted-foreground">No override configured</span>
          )}
          {snapshot?.runtime.defaultModelStatus === "unverified" ? (
            <Badge variant="destructive">not discovered</Badge>
          ) : null}
        </div>
        {defaultModel ? (
          <Button
            disabled={modelActionPending}
            onClick={() => clearProviderModel.mutate({})}
            size="sm"
            type="button"
            variant="ghost"
          >
            <XCircle className="mr-1.5 h-3.5 w-3.5" />
            Clear
          </Button>
        ) : null}
      </div>
      {activeModelSessions.length > 0 ? (
        <div className="space-y-2 border-b px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium">Active session models</span>
            <span className="text-muted-foreground">
              Change the model for a running agent session.
            </span>
          </div>
          <div className="grid gap-2">
            {activeModelSessions.map((session) => {
              const selectable =
                session.model.supportsSwitching &&
                session.model.availableModels.length > 0;
              return (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_minmax(180px,0.85fr)_auto] items-center gap-2 text-sm"
                  key={session.id}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {session.agentName ?? session.id}
                    </div>
                    <div className="truncate text-muted-foreground text-xs">
                      {session.chatStatus} / {session.model.source}
                    </div>
                  </div>
                  <Select
                    disabled={!selectable || modelActionPending}
                    onValueChange={(modelId) =>
                      setActiveSessionModel.mutate({
                        chatId: session.id,
                        modelId,
                      })
                    }
                    value={session.model.currentModelId ?? undefined}
                  >
                    <SelectTrigger className="h-8 min-w-0">
                      <SelectValue
                        placeholder={
                          selectable ? "Select active model" : "No session models"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {session.model.availableModels.map((model) => (
                        <SelectItem key={model.modelId} value={model.modelId}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Badge variant={selectable ? "default" : "outline"}>
                    {selectable ? "runtime" : "blocked"}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-[1fr_0.5fr_0.68fr_1.05fr_1.35fr_96px] border-b bg-muted/20 px-3 py-2 font-medium text-xs">
        <span>Provider</span>
        <span>Kind</span>
        <span>Ready</span>
        <span>Probe Detail</span>
        <span>Model Control</span>
        <span>Action</span>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {providers.map((provider) => {
          const selectable =
            provider.modelStatus === "ok" &&
            provider.modelListSource === "readiness-probe" &&
            provider.modelList.length > 0;
          return (
            <div
              className="grid grid-cols-[1fr_0.5fr_0.68fr_1.05fr_1.35fr_96px] gap-2 border-b px-3 py-2 text-sm last:border-b-0"
              key={provider.id}
            >
              <span className="min-w-0">
                <span className="block truncate">{provider.displayName}</span>
                <span className="block truncate text-muted-foreground text-[11px]">
                  {provider.version ??
                    (provider.lastProbedAt
                      ? `tested ${formatTime(provider.lastProbedAt)}`
                      : "not tested")}
                </span>
                {provider.remediation?.length ? (
                  <span
                    className="mt-1 block truncate text-[11px] text-muted-foreground"
                    title={provider.remediation.join("\n")}
                  >
                    {provider.remediation[0]}
                  </span>
                ) : null}
              </span>
              <span className="truncate text-muted-foreground">
                {provider.providerKind}
              </span>
              <span>
                <Badge variant={statusVariant(provider.status)}>
                  {provider.status}
                </Badge>
              </span>
              <span className="flex flex-wrap gap-1">
                <Badge variant={statusVariant(provider.cliStatus)}>
                  CLI {provider.cliStatus}
                </Badge>
                <Badge variant={statusVariant(provider.authStatus)}>
                  auth {provider.authStatus}
                </Badge>
                <Badge variant={statusVariant(provider.modelStatus)}>
                  model {provider.modelStatus}
                </Badge>
              </span>
              <span className="min-w-0 space-y-1">
                <span className="block truncate text-muted-foreground text-xs">
                  {provider.redactedEnvKeys.length > 0
                    ? `${provider.redactedEnvKeys.join(", ")} configured`
                    : "No provider secrets stored in agent config"}
                </span>
                <span className="flex min-w-0 items-center gap-1">
                  <Select
                    disabled={!selectable || modelActionPending}
                    onValueChange={(modelId) =>
                      selectProviderModel.mutate({
                        providerId: provider.id,
                        modelId,
                      })
                    }
                    value={provider.selectedModel ?? ""}
                  >
                    <SelectTrigger className="h-8 min-w-0 flex-1">
                      <SelectValue
                        placeholder={
                          selectable ? "Use model" : "Probe model readiness"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {provider.modelList.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {provider.selectedModel ? (
                    <Badge variant="default">default</Badge>
                  ) : provider.modelListSource === "fallback" ? (
                    <Badge variant="outline">probe first</Badge>
                  ) : null}
                </span>
              </span>
              <Button
                disabled={testProvider.isPending}
                onClick={() => testProvider.mutate({ providerId: provider.id })}
                size="sm"
                type="button"
                variant="outline"
              >
                <TestTube2 className="mr-1.5 h-3.5 w-3.5" />
                Test
              </Button>
            </div>
          );
        })}
        {providers.length === 0 ? (
          <div className="p-3 text-muted-foreground text-sm">
            No provider descriptors available.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function McpManager({
  snapshot,
  onProbe,
}: {
  snapshot: LocalAdeSnapshot | undefined;
  onProbe: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = React.useState("");
  const [transport, setTransport] = React.useState<McpTransport>("stdio");
  const [commandOrUrl, setCommandOrUrl] = React.useState("");
  const [messageEndpoint, setMessageEndpoint] = React.useState("");
  const [headerEnvText, setHeaderEnvText] = React.useState("");
  const [toolArgsText, setToolArgsText] = React.useState<Record<string, string>>({});
  const [remoteControlDrafts, setRemoteControlDrafts] = React.useState<
    Record<string, McpRemoteControlDraft>
  >({});
  const [lastInvocation, setLastInvocation] =
    React.useState<McpInvocationResult | null>(null);
  const upsert = trpc.settings.upsertMcpServer.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setName("");
      setCommandOrUrl("");
      setMessageEndpoint("");
      setHeaderEnvText("");
      toast.success("MCP server saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const toggle = trpc.settings.toggleMcpServer.useMutation({
    onSuccess: (data) => utils.settings.getLocalAdeSnapshot.setData(undefined, data),
    onError: (error) => toast.error(error.message),
  });
  const trustServer = trpc.settings.trustMcpServer.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("MCP invocation trusted");
    },
    onError: (error) => toast.error(error.message),
  });
  const probeServer = trpc.settings.probeMcpServer.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("MCP probe recorded");
    },
    onError: (error) => toast.error(error.message),
  });
  const invokeTool = trpc.settings.invokeMcpTool.useMutation({
    onSuccess: (result) => {
      setLastInvocation(result);
      toast[result.status === "success" ? "success" : "error"](
        `MCP tool ${result.status}`
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const readResource = trpc.settings.readMcpResource.useMutation({
    onSuccess: (result) => {
      setLastInvocation(result);
      toast[result.status === "success" ? "success" : "error"](
        `MCP resource ${result.status}`
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const watchNotifications = trpc.settings.watchMcpNotifications.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("MCP notification watch recorded");
    },
    onError: (error) => toast.error(error.message),
  });
  const configureRemoteControls =
    trpc.settings.configureMcpRemoteControls.useMutation({
      onSuccess: (data, variables) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        setRemoteControlDrafts((current) => {
          const next = { ...current };
          delete next[variables.serverId];
          return next;
        });
        toast.success("MCP remote controls saved");
      },
      onError: (error) => toast.error(error.message),
    });

  const save = () => {
    const trimmedName = name.trim();
    const target = commandOrUrl.trim();
    if (!trimmedName || !target) {
      toast.error("MCP name and command/URL are required.");
      return;
    }
    upsert.mutate({
      name: trimmedName,
      transport,
      enabled: true,
      ...(transport === "stdio" ? { command: target } : { url: target }),
      ...(transport === "sse" && messageEndpoint.trim()
        ? { messageEndpoint: messageEndpoint.trim() }
        : {}),
      ...(transport === "stdio"
        ? {}
        : { headerEnv: parseMcpHeaderEnvText(headerEnvText) }),
    });
  };

  const runTool = (
    server: NonNullable<LocalAdeSnapshot>["mcp"]["servers"][number],
    toolName: string
  ) => {
    const key = `${server.id}:${toolName}`;
    try {
      invokeTool.mutate({
        serverId: server.id,
        toolName,
        arguments: parseJsonRecordText(toolArgsText[key] ?? "{}"),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid MCP args JSON");
    }
  };

  const remoteControlDraft = (
    server: NonNullable<LocalAdeSnapshot>["mcp"]["servers"][number]
  ): McpRemoteControlDraft =>
    remoteControlDrafts[server.id] ?? {
      requestTimeoutMs: String(server.remoteControls.requestTimeoutMs),
      reconnectAttempts: String(server.remoteControls.reconnectAttempts),
      notificationWatchMs: String(server.remoteControls.notificationWatchMs),
    };

  const setRemoteControlDraftValue = (
    serverId: string,
    key: keyof McpRemoteControlDraft,
    value: string,
    fallback: McpRemoteControlDraft
  ) => {
    setRemoteControlDrafts((current) => ({
      ...current,
      [serverId]: {
        ...fallback,
        ...(current[serverId] ?? {}),
        [key]: value,
      },
    }));
  };

  const configureRemoteControlValues = (
    server: NonNullable<LocalAdeSnapshot>["mcp"]["servers"][number],
    draft: McpRemoteControlDraft
  ) => {
    const requestTimeoutMs = Number(draft.requestTimeoutMs);
    const reconnectAttempts = Number(draft.reconnectAttempts);
    const notificationWatchMs = Number(draft.notificationWatchMs);
    if (
      !Number.isFinite(requestTimeoutMs) ||
      !Number.isFinite(reconnectAttempts) ||
      !Number.isFinite(notificationWatchMs)
    ) {
      toast.error("MCP remote controls must be numeric.");
      return;
    }
    configureRemoteControls.mutate({
      serverId: server.id,
      fingerprint: server.fingerprint,
      requestTimeoutMs,
      reconnectAttempts,
      notificationWatchMs,
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-[1fr_150px_1.4fr_auto_auto]">
        <div className="grid gap-1">
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Transport</Label>
          <Select
            onValueChange={(value) => setTransport(value as McpTransport)}
            value={transport}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdio">stdio</SelectItem>
              <SelectItem value="sse">SSE</SelectItem>
              <SelectItem value="streamable-http">HTTP</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">
            {transport === "stdio"
              ? "Command"
              : transport === "sse"
                ? "Stream URL"
                : "URL"}
          </Label>
          <Input
            value={commandOrUrl}
            onChange={(event) => setCommandOrUrl(event.target.value)}
          />
        </div>
        {transport === "sse" ? (
          <div className="grid gap-1 md:col-span-3">
            <Label className="text-xs">Message Endpoint</Label>
            <Input
              placeholder="absolute URL or path from the SSE endpoint event"
              value={messageEndpoint}
              onChange={(event) => setMessageEndpoint(event.target.value)}
            />
          </div>
        ) : null}
        {transport !== "stdio" ? (
          <div className="grid gap-1 md:col-span-3">
            <Label className="text-xs">Header Env</Label>
            <Textarea
              className="min-h-16 resize-none font-mono text-xs"
              placeholder="Authorization=MCP_AUTH_TOKEN"
              value={headerEnvText}
              onChange={(event) => setHeaderEnvText(event.target.value)}
            />
          </div>
        ) : null}
        <div className="flex items-end">
          <Button disabled={upsert.isPending} onClick={save} size="sm">
            Save
          </Button>
        </div>
        <div className="flex items-end">
          <Button onClick={onProbe} size="sm" type="button" variant="outline">
            <TestTube2 className="mr-1.5 h-3.5 w-3.5" />
            Probe
          </Button>
        </div>
      </div>
      {snapshot?.mcp.agentRouting ? (
        <div className="rounded-md border bg-muted/15 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium text-sm">Agent Session Routing</div>
              <div className="text-muted-foreground text-xs">
                MCP servers that will be offered to ACP agents at session start.
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              <Badge variant={statusVariant(snapshot.mcp.agentRouting.status)}>
                {snapshot.mcp.agentRouting.status}
              </Badge>
              <Badge variant="outline">
                {snapshot.mcp.agentRouting.injectableCount} brokered
              </Badge>
              <Badge variant="outline">
                {snapshot.mcp.agentRouting.conditionalCount} conditional
              </Badge>
              {snapshot.mcp.agentRouting.blockedCount > 0 ? (
                <Badge variant="destructive">
                  {snapshot.mcp.agentRouting.blockedCount} blocked
                </Badge>
              ) : null}
            </div>
          </div>
          {snapshot.mcp.agentRouting.routes.length > 0 ? (
            <div className="mt-3 grid gap-1">
              {snapshot.mcp.agentRouting.routes.slice(0, 6).map((route) => (
                <div
                  className="grid gap-2 rounded-sm bg-background/70 px-2 py-1.5 text-[11px] md:grid-cols-[96px_1fr_1.8fr]"
                  key={`mcp-agent-route-${route.serverId}`}
                  title={route.diagnostics.join("\n")}
                >
                  <Badge variant={statusVariant(route.status)}>
                    {route.status}
                  </Badge>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {route.serverName}
                    </span>
                    <span className="block truncate font-mono text-muted-foreground">
                      {route.transport}
                      {route.requiresAgentCapability
                        ? ` / requires ${route.requiresAgentCapability}`
                        : ""}
                      {route.brokerMode ? ` / ${route.brokerMode}` : ""}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-muted-foreground">
                      {route.reason}
                    </span>
                    {route.agentInvocationCount > 0 ? (
                      <span className="block truncate font-mono text-muted-foreground">
                        agent calls: {route.agentInvocationCount}
                        {route.lastAgentInvocation
                          ? ` / ${route.lastAgentInvocation.status} ${route.lastAgentInvocation.method} ${route.lastAgentInvocation.target}`
                          : ""}
                      </span>
                    ) : null}
                    {route.headerEnv.length > 0 ? (
                      <span className="block truncate font-mono text-muted-foreground">
                        {route.headerEnv
                          .map(
                            (item) =>
                              `${item.header}->${item.envKey}${item.present ? "" : " missing"}`
                          )
                          .join(", ")}
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-muted-foreground text-xs">
              No MCP routes will be injected until a server is configured.
            </div>
          )}
          {snapshot.mcp.agentRouting.diagnostics.length > 0 ? (
            <div className="mt-2 line-clamp-2 text-muted-foreground text-[11px]">
              {snapshot.mcp.agentRouting.diagnostics.join(" ")}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-2">
        {(snapshot?.mcp.servers ?? []).map((server) => {
          const draft = remoteControlDraft(server);
          const remoteControlsAvailable = server.transport !== "stdio";
          const defaultRemoteControlDraft = {
            requestTimeoutMs: String(DEFAULT_MCP_REQUEST_TIMEOUT_MS),
            reconnectAttempts: String(DEFAULT_MCP_RECONNECT_ATTEMPTS),
            notificationWatchMs: String(DEFAULT_MCP_NOTIFICATION_WATCH_MS),
          };
          return (
          <div
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            key={server.id}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-sm">{server.name}</span>
                <Badge variant={statusVariant(server.health)}>
                  {server.health}
                </Badge>
                <Badge variant="outline">{server.transport}</Badge>
                <Badge variant={statusVariant(server.trustStatus)}>
                  trust:{server.trustStatus}
                </Badge>
              </div>
              <div className="truncate text-muted-foreground text-xs">
                {server.command ?? server.url ?? "missing target"}
                {server.messageEndpoint
                  ? `; messages: ${server.messageEndpoint}`
                  : ""}
                {server.envKeys.length > 0
                  ? `; env: ${server.envKeys.join(", ")}`
                  : ""}
                {server.headerEnv.length > 0
                  ? `; header env: ${server.headerEnv
                      .map(
                        (item) =>
                          `${item.header}->${item.envKey}${item.present ? "" : " missing"}`
                      )
                      .join(", ")}`
                  : ""}
              </div>
              <div className="truncate text-muted-foreground text-[11px]">
                {server.latencyMs !== undefined
                  ? `${server.latencyMs}ms - ${server.protocol.status}; ${server.protocol.toolsDiscovered} tools / ${server.protocol.resourcesDiscovered} resources`
                  : server.diagnostics[0] ?? "not probed"}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                <Badge variant={statusVariant(server.probe.status)}>
                  probe:{server.probe.status}
                </Badge>
                <Badge variant="outline">{server.probe.stepCount} steps</Badge>
                {server.probe.failedStepCount > 0 ? (
                  <Badge variant="destructive">
                    {server.probe.failedStepCount} failed
                  </Badge>
                ) : null}
                {server.lastProbedAt ? (
                  <span className="text-muted-foreground">
                    {formatTime(server.lastProbedAt)}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                {server.fingerprint}
                {server.trustedAt ? `; trusted ${formatTime(server.trustedAt)}` : ""}
              </div>
              <div className="mt-2 grid gap-2 border-t pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1 font-medium text-xs">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Remote Controls
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-1">
                    <Badge
                      variant={
                        remoteControlsAvailable
                          ? statusVariant(server.remoteControls.mode)
                          : "secondary"
                      }
                    >
                      {remoteControlsAvailable
                        ? server.remoteControls.mode
                        : "n/a"}
                    </Badge>
                    <Badge variant="outline">
                      {server.remoteControls.requestTimeoutMs}ms
                    </Badge>
                    <Badge variant="outline">
                      {server.remoteControls.reconnectAttempts} reconnects
                    </Badge>
                    <Badge variant="outline">
                      watch {server.remoteControls.notificationWatchMs}ms
                    </Badge>
                  </span>
                </div>
                {remoteControlsAvailable ? (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
                    <div className="grid gap-1">
                      <Label className="text-[11px]">Timeout ms</Label>
                      <Input
                        max={15000}
                        min={1000}
                        onChange={(event) =>
                          setRemoteControlDraftValue(
                            server.id,
                            "requestTimeoutMs",
                            event.target.value,
                            draft
                          )
                        }
                        step={100}
                        type="number"
                        value={draft.requestTimeoutMs}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[11px]">Reconnects</Label>
                      <Input
                        max={3}
                        min={0}
                        onChange={(event) =>
                          setRemoteControlDraftValue(
                            server.id,
                            "reconnectAttempts",
                            event.target.value,
                            draft
                          )
                        }
                        step={1}
                        type="number"
                        value={draft.reconnectAttempts}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[11px]">Watch ms</Label>
                      <Input
                        max={5000}
                        min={250}
                        onChange={(event) =>
                          setRemoteControlDraftValue(
                            server.id,
                            "notificationWatchMs",
                            event.target.value,
                            draft
                          )
                        }
                        step={250}
                        type="number"
                        value={draft.notificationWatchMs}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        disabled={!server.enabled || configureRemoteControls.isPending}
                        onClick={() => configureRemoteControlValues(server, draft)}
                        size="sm"
                        type="button"
                      >
                        <Save className="mr-1.5 h-3.5 w-3.5" />
                        Save
                      </Button>
                    </div>
                    <div className="flex items-end">
                      <Button
                        disabled={!server.enabled || configureRemoteControls.isPending}
                        onClick={() =>
                          configureRemoteControlValues(
                            server,
                            defaultRemoteControlDraft
                          )
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                        Reset
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
              {server.probe.steps.length > 0 ? (
                <div className="mt-1 grid gap-1">
                  {server.probe.steps.slice(-5).map((step, index) => (
                    <div
                      className="grid grid-cols-[90px_72px_1fr] items-center gap-2 rounded-sm bg-muted/45 px-2 py-1 text-[11px]"
                      key={`${server.id}-${step.step}-${step.startedAt}-${index}`}
                      title={[step.detail, step.error].filter(Boolean).join("\n")}
                    >
                      <span className="truncate font-mono">{step.step}</span>
                      <Badge variant={statusVariant(step.status)}>
                        {step.status}
                      </Badge>
                      <span className="truncate text-muted-foreground">
                        {step.latencyMs}ms
                        {step.error ? ` - ${step.error}` : step.detail ? ` - ${step.detail}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {server.probeHistory.length > 0 ? (
                <div className="mt-2 grid gap-1 border-t pt-2">
                  {server.probeHistory.slice(0, 3).map((run) => (
                    <div
                      className="grid grid-cols-[72px_52px_1fr] items-center gap-2 text-[11px]"
                      key={run.id}
                      title={run.diagnostics.join("\n")}
                    >
                      <Badge variant={statusVariant(run.status)}>
                        {run.status}
                      </Badge>
                      <span className="text-muted-foreground">
                        {run.durationMs}ms
                      </span>
                      <span className="truncate text-muted-foreground">
                        {formatTime(run.finishedAt)} - {run.protocolStatus};{" "}
                        {run.toolsDiscovered} tools / {run.resourcesDiscovered} resources
                        {run.failedStepCount > 0
                          ? `; ${run.failedStepCount} failed steps`
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {server.notificationMonitorHistory.length > 0 ? (
                <div className="mt-2 grid gap-1 border-t pt-2">
                  <div className="text-muted-foreground text-[11px] uppercase">
                    Notification Watch
                  </div>
                  {server.notificationMonitorHistory.slice(0, 3).map((run) => (
                    <div
                      className="grid grid-cols-[82px_78px_1fr] items-center gap-2 text-[11px]"
                      key={run.id}
                      title={run.diagnostics.join("\n")}
                    >
                      <Badge variant={statusVariant(run.status)}>
                        {run.status}
                      </Badge>
                      <span className="text-muted-foreground">
                        {run.durationMs}ms
                      </span>
                      <span className="truncate text-muted-foreground">
                        {formatTime(run.finishedAt)} - {run.notificationCount} notifications;
                        streams {run.streamOpenCount}; reconnects {run.reconnectCount}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {server.notificationHistory.length > 0 ? (
                <div className="mt-2 grid gap-1 border-t pt-2">
                  <div className="text-muted-foreground text-[11px] uppercase">
                    Server Notifications
                  </div>
                  {server.notificationHistory.slice(0, 4).map((notification) => (
                    <div
                      className="grid grid-cols-[72px_1fr] items-center gap-2 text-[11px]"
                      key={notification.id}
                      title={notification.payloadText}
                    >
                      <Badge variant="outline">{notification.source}</Badge>
                      <span className="min-w-0">
                        <span className="block truncate font-mono">
                          {notification.method}
                        </span>
                        <span className="block truncate text-muted-foreground">
                          {formatTime(notification.receivedAt)}
                          {notification.payloadText
                            ? ` - ${notification.payloadText}`
                            : ""}
                          {notification.truncated ? " [truncated]" : ""}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {server.invocationHistory.length > 0 ? (
                <div className="mt-2 grid gap-1 border-t pt-2">
                  <div className="text-muted-foreground text-[11px] uppercase">
                    Invocation Audit
                  </div>
                  {server.invocationHistory.slice(0, 3).map((run, index) => (
                    <div
                      className="grid grid-cols-[70px_88px_1fr] items-center gap-2 text-[11px]"
                      key={`${server.id}-mcp-invocation-${run.finishedAt}-${index}`}
                      title={[run.resultText, ...run.diagnostics].filter(Boolean).join("\n")}
                    >
                      <Badge variant={statusVariant(run.status)}>
                        {run.status}
                      </Badge>
                      <span className="truncate text-muted-foreground">
                        {run.method}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-mono">
                          {run.target}
                        </span>
                        <span className="block truncate text-muted-foreground">
                          {formatTime(run.finishedAt)} - {run.durationMs}ms
                          {run.resultText ? ` - ${run.resultText}` : ""}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div
                className="mt-1 line-clamp-2 text-muted-foreground text-[11px]"
                title={server.diagnostics.join("\n")}
              >
                {server.diagnostics.slice(0, 2).join(" ")}
              </div>
              {server.tools.length > 0 || server.resources.length > 0 ? (
                <div className="mt-2 grid gap-2">
                  {server.tools.slice(0, 5).map((tool) => (
                    <div
                      className="grid gap-1 rounded border bg-muted/20 p-2 text-xs md:grid-cols-[minmax(140px,0.8fr)_minmax(180px,1fr)_auto]"
                      key={`tool-${server.id}-${tool.name}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">tool:{tool.name}</div>
                        {tool.description ? (
                          <div
                            className="truncate text-muted-foreground text-[11px]"
                            title={tool.description}
                          >
                            {tool.description}
                          </div>
                        ) : null}
                      </div>
                      <Textarea
                        className="min-h-8 resize-none font-mono text-[11px]"
                        onChange={(event) =>
                          setToolArgsText((current) => ({
                            ...current,
                            [`${server.id}:${tool.name}`]: event.target.value,
                          }))
                        }
                        placeholder='{"path":"README.md"}'
                        value={toolArgsText[`${server.id}:${tool.name}`] ?? "{}"}
                      />
                      <Button
                        disabled={
                          !server.enabled ||
                          server.protocol.status !== "initialized" ||
                          server.trustStatus !== "trusted" ||
                          invokeTool.isPending
                        }
                        onClick={() => runTool(server, tool.name)}
                        size="xs"
                        type="button"
                        variant="outline"
                      >
                        <Play className="mr-1 h-3 w-3" />
                        Run
                      </Button>
                    </div>
                  ))}
                  {server.resources.slice(0, 3).map((resource) => (
                    <div
                      className="flex min-w-0 items-center justify-between gap-2 rounded border bg-muted/20 p-2 text-xs"
                      key={`resource-${server.id}-${resource.uri}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          resource:{resource.name ?? resource.uri}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {resource.uri}
                        </span>
                      </span>
                      <Button
                        disabled={
                          !server.enabled ||
                          server.protocol.status !== "initialized" ||
                          server.trustStatus !== "trusted" ||
                          readResource.isPending
                        }
                        onClick={() =>
                          readResource.mutate({
                            serverId: server.id,
                            uri: resource.uri,
                          })
                        }
                        size="xs"
                        type="button"
                        variant="outline"
                      >
                        <Eye className="mr-1 h-3 w-3" />
                        Read
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                disabled={
                  !server.enabled ||
                  trustServer.isPending ||
                  server.trustStatus === "trusted"
                }
                onClick={() =>
                  trustServer.mutate({
                    serverId: server.id,
                    fingerprint: server.fingerprint,
                  })
                }
                size="sm"
                type="button"
                variant={server.trustStatus === "trusted" ? "outline" : "default"}
              >
                Trust
              </Button>
              <Button
                disabled={!server.enabled || probeServer.isPending}
                onClick={() => probeServer.mutate({ id: server.id })}
                size="sm"
                type="button"
                variant="outline"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Retry
              </Button>
              <Button
                disabled={
                  !server.enabled ||
                  server.transport !== "sse" ||
                  server.trustStatus !== "trusted" ||
                  watchNotifications.isPending
                }
                onClick={() =>
                  watchNotifications.mutate({
                    serverId: server.id,
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <Radio className="mr-1.5 h-3.5 w-3.5" />
                Watch
              </Button>
              <Switch
                checked={server.enabled}
                disabled={toggle.isPending}
                onCheckedChange={(enabled) =>
                  toggle.mutate({ id: server.id, enabled })
                }
                size="sm"
              />
            </div>
          </div>
          );
        })}
        {(snapshot?.mcp.servers.length ?? 0) === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
            No MCP servers configured. Entries are saved to{" "}
            <code>{shortPath(snapshot?.mcp.configPath)}</code>.
          </div>
        ) : null}
      </div>
      {lastInvocation ? (
        <div className="rounded-md border">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="truncate font-medium text-xs">
              Last MCP {lastInvocation.method}: {lastInvocation.target}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Badge variant={statusVariant(lastInvocation.status)}>
                {lastInvocation.status}
              </Badge>
              <Badge variant="outline">{lastInvocation.durationMs}ms</Badge>
            </div>
          </div>
          <div className="grid gap-2 p-3 text-xs lg:grid-cols-[1fr_1fr]">
            <pre className="max-h-48 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">
              {lastInvocation.resultText || lastInvocation.resultJson || "No content"}
            </pre>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline">{lastInvocation.serverName}</Badge>
                <Badge variant="outline">{lastInvocation.transport}</Badge>
                {lastInvocation.isError ? (
                  <Badge variant="secondary">isError</Badge>
                ) : null}
                {lastInvocation.truncated ? (
                  <Badge variant="secondary">truncated</Badge>
                ) : null}
              </div>
              {lastInvocation.content.length > 0 ? (
                <div className="grid gap-1">
                  {lastInvocation.content.slice(0, 5).map((item, index) => (
                    <div
                      className="rounded bg-muted/30 px-2 py-1 text-[11px]"
                      key={`${lastInvocation.serverId}-${lastInvocation.target}-${index}`}
                    >
                      <span className="font-medium">{item.type}</span>
                      {item.uri ? (
                        <span className="ml-2 font-mono text-muted-foreground">
                          {item.uri}
                        </span>
                      ) : null}
                      {item.mimeType ? (
                        <span className="ml-2 text-muted-foreground">
                          {item.mimeType}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {lastInvocation.diagnostics.length > 0 ? (
                <div
                  className="line-clamp-3 text-muted-foreground text-[11px]"
                  title={lastInvocation.diagnostics.join("\n")}
                >
                  {lastInvocation.diagnostics.join(" ")}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HookRunner({ snapshot }: { snapshot: LocalAdeSnapshot | undefined }) {
  const utils = trpc.useUtils();
  const [name, setName] = React.useState("");
  const [event, setEvent] = React.useState("manual");
  const [policyPreset, setPolicyPreset] =
    React.useState<ExecutionPolicyPreset>("standard");
  const [command, setCommand] = React.useState("");
  const [argsText, setArgsText] = React.useState("");
  const [envKeysText, setEnvKeysText] = React.useState("");
  const [workingDirectory, setWorkingDirectory] = React.useState("");
  const [timeoutMs, setTimeoutMs] = React.useState("10000");
  const [projectRootAccess, setProjectRootAccess] = React.useState(true);
  const [runConfirmations, setRunConfirmations] = React.useState<
    Record<string, string>
  >({});
  const [hookBatchConfirmation, setHookBatchConfirmation] = React.useState("");
  const [hookBatchFailureMode, setHookBatchFailureMode] =
    React.useState<HookLifecycleFailureMode>("continue");
  const [hookAuditFilter, setHookAuditFilter] =
    React.useState<AuditReviewState>("all");
  const upsertHook = trpc.settings.upsertHook.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setName("");
      setEvent("manual");
      setPolicyPreset("standard");
      setCommand("");
      setArgsText("");
      setEnvKeysText("");
      setWorkingDirectory("");
      setTimeoutMs("10000");
      toast.success("Hook saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const toggleHook = trpc.settings.toggleHook.useMutation({
    onSuccess: (data) => utils.settings.getLocalAdeSnapshot.setData(undefined, data),
    onError: (error) => toast.error(error.message),
  });
  const updateHookLifecyclePolicy =
    trpc.settings.updateHookLifecyclePolicy.useMutation({
      onSuccess: (data) =>
        utils.settings.getLocalAdeSnapshot.setData(undefined, data),
      onError: (error) => toast.error(error.message),
    });
  const updateHookSchedulingPolicy =
    trpc.settings.updateHookSchedulingPolicy.useMutation({
      onSuccess: (data) =>
        utils.settings.getLocalAdeSnapshot.setData(undefined, data),
      onError: (error) => toast.error(error.message),
    });
  const trustHook = trpc.settings.trustHook.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Hook trusted");
    },
    onError: (error) => toast.error(error.message),
  });
  const approveHookRun = trpc.settings.approveHookRun.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Hook run approved");
    },
    onError: (error) => toast.error(error.message),
  });
  const runHook = trpc.settings.runHook.useMutation({
    onSuccess: (data, variables) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setRunConfirmations((current) => {
        const next = { ...current };
        delete next[variables.hookId];
        return next;
      });
      toast.success("Hook executed");
    },
    onError: (error) => toast.error(error.message),
  });
  const runHookBatch = trpc.settings.runHookBatch.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setHookBatchConfirmation("");
      toast.success("Hook batch executed");
    },
    onError: (error) => toast.error(error.message),
  });
  const reviewHookRun = trpc.settings.reviewHookRun.useMutation({
    onSuccess: (data, variables) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success(variables.reviewed ? "Hook run reviewed" : "Hook run reopened");
    },
    onError: (error) => toast.error(error.message),
  });
  const exportHookRuns = trpc.settings.exportHookRuns.useMutation();

  const save = () => {
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    const parsedTimeout = Number(timeoutMs);
    if (!trimmedName || !trimmedCommand) {
      toast.error("Hook name and command are required.");
      return;
    }
    if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
      toast.error("Hook timeout must be a positive number.");
      return;
    }
    upsertHook.mutate({
      name: trimmedName,
      event: event.trim() || "manual",
      policyPreset,
      command: trimmedCommand,
      args: parseHookArgsText(argsText),
      envKeys: parseEnvKeysText(envKeysText),
      timeoutMs: Math.floor(parsedTimeout),
      ...(workingDirectory.trim()
        ? { workingDirectory: workingDirectory.trim() }
        : {}),
    });
  };

  const hooks = snapshot?.hooks.items ?? [];
  const lifecyclePolicy = snapshot?.hooks.lifecyclePolicy;
  const hookSchedulingPolicy = snapshot?.hooks.schedulingPolicy;
  const recentHookBatches = snapshot?.hooks.recentBatches ?? [];
  const readyHookBatchItems = hooks
    .filter(
      (hook) =>
        hook.enabled &&
        hook.trustStatus === "trusted" &&
        hook.executionPolicy.status === "allowed" &&
        hook.scheduling.status === "ready"
    )
    .slice(0, 8);
  const hookBatchConfirmed =
    hookBatchConfirmation.trim() === "RUN HOOK BATCH";
  const lifecycleEvents = HOOK_EVENT_OPTIONS.filter(
    (option) => option.value !== "manual"
  );
  const recentHookRuns = snapshot?.hooks.recentRuns ?? [];
  const visibleHookRuns = recentHookRuns.filter((run) =>
    matchesAuditReviewState(run.reviewedAt, hookAuditFilter)
  );
  const copyHookAudit = async () => {
    try {
      const audit = await exportHookRuns.mutateAsync({
        reviewState: hookAuditFilter,
        limit: 40,
      });
      await copyJsonToClipboard(audit, "Hook audit copied");
    } catch (error) {
      console.error("Hook audit export failed", error);
      toast.error(error instanceof Error ? error.message : "Hook audit export failed");
    }
  };

  const toggleLifecycleEvent = (eventName: string, paused: boolean) => {
    const current = new Set(lifecyclePolicy?.disabledEvents ?? []);
    if (paused) {
      current.add(eventName);
    } else {
      current.delete(eventName);
    }
    updateHookLifecyclePolicy.mutate({
      disabledEvents: [...current],
    });
  };
  const runReadyHookBatch = () => {
    const operationFingerprints = Object.fromEntries(
      readyHookBatchItems.map((hook) => [hook.id, hook.runOperation.fingerprint])
    );
    runHookBatch.mutate({
      hookIds: readyHookBatchItems.map((hook) => hook.id),
      operationFingerprints,
      confirmation: hookBatchConfirmation.trim(),
      failureMode: hookBatchFailureMode,
    });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/20 p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(160px,220px)_minmax(160px,220px)_1fr]">
          <div className="grid gap-1">
            <Label className="text-xs">Lifecycle Dispatch</Label>
            <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-3">
              <Switch
                checked={lifecyclePolicy?.enabled ?? true}
                disabled={updateHookLifecyclePolicy.isPending}
                onCheckedChange={(enabled) =>
                  updateHookLifecyclePolicy.mutate({ enabled })
                }
                size="sm"
              />
              <span className="text-xs">
                {lifecyclePolicy?.enabled === false ? "paused" : "enabled"}
              </span>
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Failure Mode</Label>
            <Select
              disabled={updateHookLifecyclePolicy.isPending}
              onValueChange={(value) =>
                updateHookLifecyclePolicy.mutate({
                  failureMode: value as HookLifecycleFailureMode,
                })
              }
              value={lifecyclePolicy?.failureMode ?? "continue"}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOOK_LIFECYCLE_FAILURE_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Paused Events</Label>
            <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2">
              {lifecycleEvents.map((option) => {
                const paused = Boolean(
                  lifecyclePolicy?.disabledEvents.includes(option.value)
                );
                return (
                  <label
                    className="flex items-center gap-1.5 text-xs"
                    key={option.value}
                  >
                    <Checkbox
                      checked={paused}
                      disabled={updateHookLifecyclePolicy.isPending}
                      onCheckedChange={(checked) =>
                        toggleLifecycleEvent(option.value, checked === true)
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge
            variant={lifecyclePolicy?.enabled === false ? "secondary" : "default"}
          >
            lifecycle {lifecyclePolicy?.enabled === false ? "paused" : "enabled"}
          </Badge>
          <Badge variant="outline">
            failure {lifecyclePolicy?.failureMode ?? "continue"}
          </Badge>
          <Badge variant="outline">
            paused {lifecyclePolicy?.disabledEvents.length ?? 0}
          </Badge>
          {lifecyclePolicy?.updatedAt ? (
            <Badge variant="outline">
              updated {formatTime(lifecyclePolicy.updatedAt)}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="rounded-md border bg-muted/20 p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(160px,220px)_minmax(160px,220px)_minmax(160px,220px)_1fr]">
          <div className="grid gap-1">
            <Label className="text-xs">Run Scheduling</Label>
            <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-3">
              <Switch
                checked={hookSchedulingPolicy?.enabled ?? true}
                disabled={updateHookSchedulingPolicy.isPending}
                onCheckedChange={(enabled) =>
                  updateHookSchedulingPolicy.mutate({ enabled })
                }
                size="sm"
              />
              <span className="text-xs">
                {hookSchedulingPolicy?.enabled === false ? "paused" : "enabled"}
              </span>
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Parallel Limit</Label>
            <Select
              disabled={updateHookSchedulingPolicy.isPending}
              onValueChange={(value) =>
                updateHookSchedulingPolicy.mutate({
                  maxConcurrentRuns: Number(value),
                })
              }
              value={String(hookSchedulingPolicy?.maxConcurrentRuns ?? 1)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTOMATION_PARALLEL_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Cooldown</Label>
            <Select
              disabled={updateHookSchedulingPolicy.isPending}
              onValueChange={(value) =>
                updateHookSchedulingPolicy.mutate({ cooldownMs: Number(value) })
              }
              value={String(hookSchedulingPolicy?.cooldownMs ?? 0)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTOMATION_COOLDOWN_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-end gap-1">
            <Badge
              variant={hookSchedulingPolicy?.enabled === false ? "secondary" : "default"}
            >
              schedule {hookSchedulingPolicy?.enabled === false ? "paused" : "enabled"}
            </Badge>
            <Badge variant="outline">
              parallel {hookSchedulingPolicy?.maxConcurrentRuns ?? 1}
            </Badge>
            <Badge variant="outline">
              cooldown {hookSchedulingPolicy?.cooldownMs ?? 0}ms
            </Badge>
            {hookSchedulingPolicy?.updatedAt ? (
              <Badge variant="outline">
                updated {formatTime(hookSchedulingPolicy.updatedAt)}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>
      <div className="rounded-md border bg-muted/20 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Play className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium text-xs uppercase">Batch Queue</span>
            <Badge variant="outline">{readyHookBatchItems.length} ready</Badge>
          </div>
          {recentHookBatches[0] ? (
            <Badge variant={statusVariant(recentHookBatches[0].status)}>
              last {recentHookBatches[0].status}
            </Badge>
          ) : null}
        </div>
        {recentHookBatches.length > 0 ? (
          <div className="mb-2 grid gap-1">
            {recentHookBatches.slice(0, 3).map((batch) => (
              <div
                className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border bg-background px-2 py-1 text-[11px]"
                key={batch.id}
              >
                <Badge variant={statusVariant(batch.status)}>{batch.status}</Badge>
                <span className="truncate font-mono">{batch.id}</span>
                <span className="text-muted-foreground">
                  {batch.counts.success} ok / {batch.counts.failed} failed /{" "}
                  {batch.counts.disabled} skipped
                </span>
                <span className="text-muted-foreground">
                  {formatTime(batch.finishedAt)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="grid gap-2 lg:grid-cols-[1fr_180px_auto]">
          <div className="grid gap-1">
            <Label className="text-xs">Confirmation</Label>
            <Input
              className="font-mono text-xs"
              onChange={(event) => setHookBatchConfirmation(event.target.value)}
              placeholder="RUN HOOK BATCH"
              value={hookBatchConfirmation}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Failure Mode</Label>
            <Select
              onValueChange={(value) =>
                setHookBatchFailureMode(value as HookLifecycleFailureMode)
              }
              value={hookBatchFailureMode}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOOK_LIFECYCLE_FAILURE_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              disabled={
                runHookBatch.isPending ||
                !hookBatchConfirmed ||
                readyHookBatchItems.length === 0
              }
              onClick={runReadyHookBatch}
              size="sm"
              type="button"
              variant="outline"
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Run Batch
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {readyHookBatchItems.length > 0 ? (
            readyHookBatchItems.map((hook) => (
              <Badge key={hook.id} variant="secondary">
                {hook.name}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground text-xs">
              No trusted, schedulable hooks are ready.
            </span>
          )}
        </div>
      </div>
      <div className="grid gap-2 xl:grid-cols-[1fr_120px_150px_1fr_90px]">
        <div className="grid gap-1">
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Event</Label>
          <Select onValueChange={setEvent} value={event}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOOK_EVENT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Policy</Label>
          <Select
            onValueChange={(value) =>
              setPolicyPreset(value as ExecutionPolicyPreset)
            }
            value={policyPreset}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXECUTION_POLICY_PRESET_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Command</Label>
          <Input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Timeout</Label>
          <Input
            inputMode="numeric"
            value={timeoutMs}
            onChange={(event) => setTimeoutMs(event.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-2 xl:grid-cols-[1fr_1fr_170px_auto]">
        <div className="grid gap-1">
          <Label className="text-xs">Args</Label>
          <Textarea
            className="min-h-20 resize-y font-mono text-xs"
            onChange={(event) => setArgsText(event.target.value)}
            placeholder="one argument per line"
            value={argsText}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Env Keys</Label>
          <Textarea
            className="min-h-20 resize-y font-mono text-xs"
            onChange={(event) => setEnvKeysText(event.target.value)}
            placeholder="optional env key allowlist"
            value={envKeysText}
          />
        </div>

        <div className="grid gap-1">
          <Label className="text-xs">Working Directory</Label>
          <Input
            onChange={(event) => setWorkingDirectory(event.target.value)}
            placeholder="relative to project root"
            value={workingDirectory}
          />
          <div className="truncate text-muted-foreground text-[11px]">
            {shortPath(snapshot?.hooks.configPath)}
          </div>
        </div>
        <div className="flex items-end">
          <Button disabled={upsertHook.isPending} onClick={save} size="sm">
            Save Hook
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {HOOK_EVENT_OPTIONS.map((option) => (
          <Badge key={option.value} variant="outline">
            {option.label}
          </Badge>
        ))}
      </div>
      <div className="grid gap-2">
        {hooks.map((hook) => {
          const runConfirmation = runConfirmations[hook.id]?.trim() ?? "";
          const runConfirmed = runConfirmation === hook.runConfirmationToken;
          const runApproved =
            hook.runOperation.approvalStatus === "approved" &&
            Boolean(hook.runOperation.approvalId);
          return (
          <div className="rounded-md border p-3" key={hook.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-sm">{hook.name}</span>
                  <Badge variant={hook.enabled ? "default" : "outline"}>
                    {hook.enabled ? "enabled" : "off"}
                  </Badge>
                  <Badge variant="outline">{hook.event}</Badge>
                  <Badge
                    variant={
                      hook.policyPreset === "standard" ? "outline" : "secondary"
                    }
                  >
                    policy {hook.policyPreset}
                  </Badge>
                  <Badge variant={statusVariant(hook.trustStatus)}>
                    {hook.trustStatus}
                  </Badge>
                  <Badge variant={statusVariant(hook.executionPolicy.status)}>
                    sandbox {hook.executionPolicy.status}
                  </Badge>
                  <Badge variant="outline">
                    tree {hook.executionPolicy.isolation.processTreeKill}
                  </Badge>
                  <Badge variant={statusVariant(hook.runOperation.approvalStatus)}>
                    run {hook.runOperation.approvalStatus}
                  </Badge>
                  <Badge variant={statusVariant(hook.scheduling.status)}>
                    schedule {hook.scheduling.status}
                  </Badge>
                  <Badge variant={hook.envKeys.length > 0 ? "secondary" : "outline"}>
                    {hook.envKeys.length > 0
                      ? `${hook.envKeys.length} env keys`
                      : "isolated env"}
                  </Badge>
                  {hook.lastRun ? (
                    <Badge variant={statusVariant(hook.lastRun.status)}>
                      {hook.lastRun.status}
                    </Badge>
                  ) : null}
                  {hook.lastRun ? (
                    <Badge variant={hook.lastRun.reviewedAt ? "default" : "secondary"}>
                      {hook.lastRun.reviewedAt ? "reviewed" : "open"}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-1 truncate font-mono text-muted-foreground text-xs">
                  {hook.command}
                  {hook.args.length > 0 ? ` ${hook.args.join(" ")}` : ""}
                </div>
                <div className="mt-1 truncate text-muted-foreground text-[11px]">
                  {hook.workingDirectory
                    ? `cwd ${hook.workingDirectory}; `
                    : "cwd project root; "}
                  timeout {hook.timeoutMs}ms
                </div>
                <div className="mt-1 truncate text-muted-foreground text-[11px]">
                  env {hook.envKeys.length > 0 ? hook.envKeys.join(", ") : "none"}
                </div>
                <div className="mt-1 truncate font-mono text-muted-foreground text-[11px]">
                  {hook.fingerprint}
                  {hook.trustedAt ? `; trusted ${formatTime(hook.trustedAt)}` : ""}
                </div>
                <div className="mt-1 truncate font-mono text-muted-foreground text-[11px]">
                  {hook.runOperation.fingerprint}
                  {hook.runOperation.expiresAt
                    ? `; approval expires ${formatTime(hook.runOperation.expiresAt)}`
                    : ""}
                </div>
                <div className="mt-1 truncate text-muted-foreground text-[11px]">
                  operation {hook.runOperation.event}; cwd {hook.runOperation.cwd};
                  approval {hook.runOperation.approvalStatus}
                </div>
                <div className="mt-1 truncate text-muted-foreground text-[11px]">
                  isolation {hook.runOperation.isolation.mode}; cwd{" "}
                  {hook.runOperation.isolation.cwdScope}; tree kill{" "}
                  {hook.runOperation.isolation.processTreeKill}
                </div>
                <div className="mt-1 truncate text-muted-foreground text-[11px]">
                  schedule active {hook.scheduling.activeRuns}/
                  {hook.scheduling.maxConcurrentRuns}; cooldown{" "}
                  {hook.scheduling.cooldownMs}ms
                  {hook.scheduling.nextAllowedAt
                    ? `; next ${formatTime(hook.scheduling.nextAllowedAt)}`
                    : ""}
                </div>
                {hook.executionPolicy.blockers.length > 0 ? (
                  <div className="mt-1 line-clamp-2 text-destructive text-[11px]">
                    {hook.executionPolicy.blockers.join(" ")}
                  </div>
                ) : null}
              </div>
              <div className="grid w-56 shrink-0 gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs">Run Confirmation</Label>
                  <Input
                    aria-label={`Run confirmation for ${hook.name}`}
                    className="font-mono text-xs"
                    onChange={(event) =>
                      setRunConfirmations((current) => ({
                        ...current,
                        [hook.id]: event.target.value,
                      }))
                    }
                    placeholder={hook.runConfirmationToken}
                    value={runConfirmations[hook.id] ?? ""}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={trustHook.isPending || hook.trustStatus === "trusted"}
                  onClick={() =>
                    trustHook.mutate({
                      hookId: hook.id,
                      fingerprint: hook.fingerprint,
                    })
                  }
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Trust
                </Button>
                <Button
                  disabled={
                    approveHookRun.isPending ||
                    !hook.enabled ||
                    hook.trustStatus !== "trusted" ||
                    hook.executionPolicy.status !== "allowed" ||
                    hook.scheduling.status !== "ready" ||
                    hook.runOperation.approvalStatus === "approved"
                  }
                  onClick={() =>
                    approveHookRun.mutate({
                      hookId: hook.id,
                      operationFingerprint: hook.runOperation.fingerprint,
                    })
                  }
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Approve run
                </Button>
                <Button
                  disabled={
                    runHook.isPending ||
                    !hook.enabled ||
                    hook.trustStatus !== "trusted" ||
                    hook.executionPolicy.status !== "allowed" ||
                    hook.scheduling.status !== "ready" ||
                    !runApproved ||
                    !runConfirmed
                  }
                  onClick={() =>
                    runHook.mutate({
                      hookId: hook.id,
                      confirmation: runConfirmation,
                      operationApprovalId: hook.runOperation.approvalId ?? "",
                    })
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Run
                </Button>
                <Switch
                  checked={hook.enabled}
                  disabled={toggleHook.isPending}
                  onCheckedChange={(enabled) =>
                    toggleHook.mutate({ id: hook.id, enabled })
                  }
                  size="sm"
                />
                </div>
              </div>
            </div>
            {hook.lastRun ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-muted-foreground text-[11px]">
                    Last run {formatTime(hook.lastRun.finishedAt)} -{" "}
                    {hook.lastRun.durationMs}ms
                    {hook.lastRun.batchId ? ` - batch ${hook.lastRun.batchId}` : ""}
                  </div>
                  <Button
                    disabled={reviewHookRun.isPending}
                    onClick={() =>
                      reviewHookRun.mutate({
                        runId: hook.lastRun!.id,
                        reviewed: !hook.lastRun!.reviewedAt,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {hook.lastRun.reviewedAt ? (
                      <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                    ) : (
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {hook.lastRun.reviewedAt ? "Reopen" : "Review"}
                  </Button>
                </div>
                <div className="grid gap-2 xl:grid-cols-2">
                  <div className="min-w-0 rounded bg-muted/30 p-2">
                    <div className="mb-1 text-muted-foreground text-[11px]">
                      stdout
                    </div>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
                      {hook.lastRun.stdout || "No stdout"}
                    </pre>
                  </div>
                  <div className="min-w-0 rounded bg-muted/30 p-2">
                    <div className="mb-1 text-muted-foreground text-[11px]">
                      stderr / diagnostics
                    </div>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
                      {hook.lastRun.stderr ||
                        hook.lastRun.diagnostics.slice(0, 3).join("\n") ||
                        "No stderr"}
                    </pre>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          );
        })}
        {hooks.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
            No hooks configured. Add a manual hook to create an executable
            project-local hook surface.
          </div>
        ) : null}
      </div>
      {recentHookRuns.length > 0 ? (
        <div className="rounded-md border bg-muted/20">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <div className="font-medium text-sm">Run Audit</div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                onValueChange={(value) =>
                  setHookAuditFilter(value as AuditReviewState)
                }
                value={hookAuditFilter}
              >
                <SelectTrigger className="h-8 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIT_REVIEW_FILTERS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={exportHookRuns.isPending}
                onClick={() => {
                  void copyHookAudit();
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copy Audit
              </Button>
              <Badge variant="outline">
                {visibleHookRuns.length}/{recentHookRuns.length} runs
              </Badge>
            </div>
          </div>
          <div className="divide-y">
            {visibleHookRuns.slice(0, 8).map((run) => (
              <div
                className="grid gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                key={run.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-xs">
                      {run.hookName}
                    </span>
                    <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                    <Badge variant={run.reviewedAt ? "default" : "secondary"}>
                      {run.reviewedAt ? "reviewed" : "open"}
                    </Badge>
                    {run.batchId ? (
                      <Badge variant="outline">batch</Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate text-muted-foreground text-[11px]">
                    {run.event} - {formatTime(run.finishedAt)} - {run.durationMs}ms
                    {run.batchId ? ` - ${run.batchId}` : ""}
                  </div>
                  <div className="mt-1 truncate font-mono text-muted-foreground text-[11px]">
                    {run.stdout ||
                      run.stderr ||
                      run.diagnostics.slice(0, 1).join(" ") ||
                      "No output"}
                  </div>
                </div>
                <div className="flex items-center sm:justify-end">
                  <Button
                    disabled={reviewHookRun.isPending}
                    onClick={() =>
                      reviewHookRun.mutate({
                        runId: run.id,
                        reviewed: !run.reviewedAt,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {run.reviewedAt ? (
                      <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                    ) : (
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {run.reviewedAt ? "Reopen" : "Review"}
                  </Button>
                </div>
              </div>
            ))}
            {visibleHookRuns.length === 0 ? (
              <div className="px-3 py-2 text-muted-foreground text-xs">
                No hook runs match this audit filter.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PluginRunner({ snapshot }: { snapshot: LocalAdeSnapshot | undefined }) {
  const utils = trpc.useUtils();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [policyPreset, setPolicyPreset] =
    React.useState<ExecutionPolicyPreset>("standard");
  const [command, setCommand] = React.useState("");
  const [argsText, setArgsText] = React.useState("");
  const [envKeysText, setEnvKeysText] = React.useState("");
  const [dependencyIdsText, setDependencyIdsText] = React.useState("");
  const [workingDirectory, setWorkingDirectory] = React.useState("");
  const [timeoutMs, setTimeoutMs] = React.useState("10000");
  const [projectRootAccess, setProjectRootAccess] = React.useState(true);
  const [packageManifestPath, setPackageManifestPath] = React.useState("");
  const [pluginRegistryName, setPluginRegistryName] = React.useState("");
  const [pluginRegistryUrl, setPluginRegistryUrl] = React.useState("");
  const [pluginRegistryPackageId, setPluginRegistryPackageId] = React.useState("");
  const [runConfirmations, setRunConfirmations] = React.useState<
    Record<string, string>
  >({});
  const [pluginBatchConfirmation, setPluginBatchConfirmation] =
    React.useState("");
  const [pluginBatchFailureMode, setPluginBatchFailureMode] = React.useState<
    "continue" | "stop-on-failure"
  >("continue");
  const [pluginBatchPresetName, setPluginBatchPresetName] = React.useState("");
  const [pluginBatchScheduleName, setPluginBatchScheduleName] =
    React.useState("");
  const [pluginBatchSchedulePresetId, setPluginBatchSchedulePresetId] =
    React.useState("");
  const [pluginBatchScheduleIntervalMs, setPluginBatchScheduleIntervalMs] =
    React.useState("300000");
  const [pluginAuditFilter, setPluginAuditFilter] =
    React.useState<AuditReviewState>("all");
  const upsertPlugin = trpc.settings.upsertPlugin.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setName("");
      setDescription("");
      setPolicyPreset("standard");
      setCommand("");
      setArgsText("");
      setEnvKeysText("");
      setDependencyIdsText("");
      setWorkingDirectory("");
      setTimeoutMs("10000");
      setProjectRootAccess(true);
      toast.success("Plugin saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const installPluginPackage = trpc.settings.installPluginPackage.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setPackageManifestPath("");
      setPluginRegistryPackageId("");
      toast.success("Signed plugin installed");
    },
    onError: (error) => toast.error(error.message),
  });
  const revalidatePluginPackage =
    trpc.settings.revalidatePluginPackage.useMutation({
      onSuccess: (data) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        toast.success("Plugin package revalidated");
      },
      onError: (error) => toast.error(error.message),
    });
  const upsertPluginRegistry = trpc.settings.upsertPluginRegistry.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setPluginRegistryName("");
      toast.success("Plugin registry saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const trustPluginRegistry = trpc.settings.trustPluginRegistry.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Plugin registry trusted");
    },
    onError: (error) => toast.error(error.message),
  });
  const revokePluginRegistryTrust =
    trpc.settings.revokePluginRegistryTrust.useMutation({
      onSuccess: (data) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        toast.success("Plugin registry trust revoked");
      },
      onError: (error) => toast.error(error.message),
    });
  const revokePluginRegistrySigner =
    trpc.settings.revokePluginRegistrySigner.useMutation({
      onSuccess: (data) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        toast.success("Plugin registry signer revoked");
      },
      onError: (error) => toast.error(error.message),
    });
  const restorePluginRegistrySigner =
    trpc.settings.restorePluginRegistrySigner.useMutation({
      onSuccess: (data) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        toast.success("Plugin registry signer restored");
      },
      onError: (error) => toast.error(error.message),
    });
  const refreshPluginRegistry = trpc.settings.refreshPluginRegistry.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Plugin registry refreshed");
    },
    onError: (error) => toast.error(error.message),
  });
  const installPluginRegistryPackage =
    trpc.settings.installPluginRegistryPackage.useMutation({
      onSuccess: (data) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        toast.success("Registry package installed");
      },
      onError: (error) => toast.error(error.message),
    });
  const togglePlugin = trpc.settings.togglePlugin.useMutation({
    onSuccess: (data) => utils.settings.getLocalAdeSnapshot.setData(undefined, data),
    onError: (error) => toast.error(error.message),
  });
  const trustPlugin = trpc.settings.trustPlugin.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Plugin trusted");
    },
    onError: (error) => toast.error(error.message),
  });
  const updatePluginPermissionGrant =
    trpc.settings.updatePluginPermissionGrant.useMutation({
      onSuccess: (data, variables) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        toast.success(
          variables.granted
            ? "Plugin permissions granted"
            : "Plugin permissions revoked"
        );
      },
      onError: (error) => toast.error(error.message),
    });
  const approvePluginRun = trpc.settings.approvePluginRun.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Plugin run approved");
    },
    onError: (error) => toast.error(error.message),
  });
  const runPlugin = trpc.settings.runPlugin.useMutation({
    onSuccess: (data, variables) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setRunConfirmations((current) => {
        const next = { ...current };
        delete next[variables.pluginId];
        return next;
      });
      toast.success("Plugin executed");
    },
    onError: (error) => toast.error(error.message),
  });
  const runPluginBatch = trpc.settings.runPluginBatch.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setPluginBatchConfirmation("");
      toast.success("Plugin batch executed");
    },
    onError: (error) => toast.error(error.message),
  });
  const upsertPluginBatchPreset =
    trpc.settings.upsertPluginBatchPreset.useMutation({
      onSuccess: (data) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        setPluginBatchPresetName("");
        toast.success("Plugin batch preset saved");
      },
      onError: (error) => toast.error(error.message),
    });
  const deletePluginBatchPreset =
    trpc.settings.deletePluginBatchPreset.useMutation({
      onSuccess: (data) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        toast.success("Plugin batch preset deleted");
      },
      onError: (error) => toast.error(error.message),
    });
  const runPluginBatchPreset = trpc.settings.runPluginBatchPreset.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setPluginBatchConfirmation("");
      toast.success("Plugin batch preset executed");
    },
    onError: (error) => toast.error(error.message),
  });
  const upsertPluginBatchSchedule =
    trpc.settings.upsertPluginBatchSchedule.useMutation({
      onSuccess: (data) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        setPluginBatchScheduleName("");
        toast.success("Plugin batch schedule saved");
      },
      onError: (error) => toast.error(error.message),
    });
  const deletePluginBatchSchedule =
    trpc.settings.deletePluginBatchSchedule.useMutation({
      onSuccess: (data) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        toast.success("Plugin batch schedule deleted");
      },
      onError: (error) => toast.error(error.message),
    });
  const runDuePluginBatchSchedules =
    trpc.settings.runDuePluginBatchSchedules.useMutation({
      onSuccess: (data) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        toast.success("Due plugin schedules processed");
      },
      onError: (error) => toast.error(error.message),
    });
  const updatePluginSchedulingPolicy =
    trpc.settings.updatePluginSchedulingPolicy.useMutation({
      onSuccess: (data) =>
        utils.settings.getLocalAdeSnapshot.setData(undefined, data),
      onError: (error) => toast.error(error.message),
    });
  const reviewPluginRun = trpc.settings.reviewPluginRun.useMutation({
    onSuccess: (data, variables) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success(
        variables.reviewed ? "Plugin run reviewed" : "Plugin run reopened"
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const exportPluginRuns = trpc.settings.exportPluginRuns.useMutation();

  const save = () => {
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    const parsedTimeout = Number(timeoutMs);
    if (!trimmedName || !trimmedCommand) {
      toast.error("Plugin name and command are required.");
      return;
    }
    if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
      toast.error("Plugin timeout must be a positive number.");
      return;
    }
    const envKeys = parseEnvKeysText(envKeysText);
    const dependencyIds = parseIdentifierListText(dependencyIdsText);
    const scopes = [
      "process",
      ...(projectRootAccess ? ["project-root"] : []),
      ...(envKeys.length > 0 ? ["env"] : []),
    ] as Array<"process" | "project-root" | "env">;
    upsertPlugin.mutate({
      name: trimmedName,
      ...(description.trim() ? { description: description.trim() } : {}),
      policyPreset,
      scopes,
      ...(dependencyIds.length > 0 ? { dependencyIds } : {}),
      envKeys,
      command: trimmedCommand,
      args: parseHookArgsText(argsText),
      timeoutMs: Math.floor(parsedTimeout),
      ...(workingDirectory.trim()
        ? { workingDirectory: workingDirectory.trim() }
        : {}),
    });
  };

  const installSignedPackage = () => {
    const manifestPath = packageManifestPath.trim();
    if (!manifestPath) {
      toast.error("Signed package manifest path is required.");
      return;
    }
    installPluginPackage.mutate({ manifestPath });
  };

  const installRegistryPackage = () => {
    const registryUrl = pluginRegistryUrl.trim();
    const packageId = pluginRegistryPackageId.trim();
    if (!registryUrl || !packageId) {
      toast.error("Registry URL and package ID are required.");
      return;
    }
    installPluginPackage.mutate({ registryUrl, packageId });
  };

  const savePluginRegistry = () => {
    const url = pluginRegistryUrl.trim();
    if (!url) {
      toast.error("Registry URL is required.");
      return;
    }
    upsertPluginRegistry.mutate({
      name: pluginRegistryName.trim() || "Signed Plugin Registry",
      url,
    });
  };

  const plugins = snapshot?.plugins.items ?? [];
  const pluginSchedulingPolicy = snapshot?.plugins.schedulingPolicy;
  const pluginCatalog = snapshot?.plugins.catalog ?? [];
  const pluginRegistries = snapshot?.plugins.registries ?? [];
  const recentPluginRuns = snapshot?.plugins.recentRuns ?? [];
  const recentPluginBatches = snapshot?.plugins.recentBatches ?? [];
  const pluginBatchPresets = snapshot?.plugins.batchPresets ?? [];
  const pluginBatchSchedules = snapshot?.plugins.batchSchedules ?? [];
  const pluginDependencyGraph = snapshot?.plugins.dependencyGraph;
  const duePluginBatchSchedules = pluginBatchSchedules.filter((schedule) => {
    const nextRunMs = Date.parse(schedule.nextRunAt);
    return schedule.enabled && Number.isFinite(nextRunMs) && nextRunMs <= Date.now();
  });
  const pluginBatchCandidates = plugins
    .filter(
      (plugin) =>
        plugin.enabled &&
        plugin.trustStatus === "trusted" &&
        plugin.permissionStatus === "granted" &&
        plugin.executionPolicy.status === "allowed" &&
        plugin.scheduling.status === "ready" &&
        plugin.packageExpiryStatus !== "expired"
    )
    .slice(0, 8);
  const pluginBatchConfirmed =
    pluginBatchConfirmation.trim() === "RUN PLUGIN BATCH";
  const visiblePluginRuns = recentPluginRuns.filter((run) =>
    matchesAuditReviewState(run.reviewedAt, pluginAuditFilter)
  );
  const runReadyPluginBatch = () => {
    if (pluginBatchCandidates.length === 0) {
      toast.error("No ready trusted plugins are available for batch execution.");
      return;
    }
    runPluginBatch.mutate({
      pluginIds: pluginBatchCandidates.map((plugin) => plugin.id),
      operationFingerprints: Object.fromEntries(
        pluginBatchCandidates.map((plugin) => [
          plugin.id,
          plugin.runOperation.fingerprint,
        ])
      ),
      confirmation: pluginBatchConfirmation.trim(),
      failureMode: pluginBatchFailureMode,
    });
  };
  const saveReadyPluginBatchPreset = () => {
    const presetName = pluginBatchPresetName.trim();
    if (!presetName) {
      toast.error("Preset name is required.");
      return;
    }
    if (pluginBatchCandidates.length === 0) {
      toast.error("No ready trusted plugins are available for a batch preset.");
      return;
    }
    upsertPluginBatchPreset.mutate({
      name: presetName,
      pluginIds: pluginBatchCandidates.map((plugin) => plugin.id),
      failureMode: pluginBatchFailureMode,
    });
  };
  const getPresetReadyPlugins = (pluginIds: string[]) =>
    pluginIds
      .map((pluginId) => plugins.find((plugin) => plugin.id === pluginId))
      .filter((plugin): plugin is (typeof plugins)[number] => Boolean(plugin));
  const isPluginReadyForBatch = (plugin: (typeof plugins)[number]) =>
    plugin.enabled &&
    plugin.trustStatus === "trusted" &&
    plugin.permissionStatus === "granted" &&
    plugin.executionPolicy.status === "allowed" &&
    plugin.scheduling.status === "ready" &&
    plugin.packageExpiryStatus !== "expired";
  const runSavedPluginBatchPreset = (
    preset: NonNullable<LocalAdeSnapshot>["plugins"]["batchPresets"][number]
  ) => {
    const presetPlugins = getPresetReadyPlugins(preset.pluginIds);
    if (
      presetPlugins.length !== preset.pluginIds.length ||
      !presetPlugins.every(isPluginReadyForBatch)
    ) {
      toast.error("Preset includes plugins that are missing or not ready.");
      return;
    }
    runPluginBatchPreset.mutate({
      presetId: preset.id,
      operationFingerprints: Object.fromEntries(
        presetPlugins.map((plugin) => [plugin.id, plugin.runOperation.fingerprint])
      ),
      confirmation: pluginBatchConfirmation.trim(),
    });
  };
  const savePluginBatchSchedule = () => {
    const presetId = pluginBatchSchedulePresetId || pluginBatchPresets[0]?.id;
    const preset = pluginBatchPresets.find((item) => item.id === presetId);
    const scheduleName = pluginBatchScheduleName.trim();
    const intervalMs = Number(pluginBatchScheduleIntervalMs);
    if (!preset) {
      toast.error("Select a plugin batch preset before scheduling.");
      return;
    }
    if (!scheduleName) {
      toast.error("Schedule name is required.");
      return;
    }
    if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
      toast.error("Schedule interval must be at least one second.");
      return;
    }
    const presetPlugins = preset.pluginIds
      .map((pluginId) => plugins.find((plugin) => plugin.id === pluginId))
      .filter((plugin): plugin is (typeof plugins)[number] => Boolean(plugin));
    if (presetPlugins.length !== preset.pluginIds.length) {
      toast.error("Preset includes missing plugins.");
      return;
    }
    upsertPluginBatchSchedule.mutate({
      name: scheduleName,
      presetId: preset.id,
      intervalMs,
      nextRunAt: new Date().toISOString(),
      operationFingerprints: Object.fromEntries(
        presetPlugins.map((plugin) => [
          plugin.id,
          plugin.runOperation.fingerprint,
        ])
      ),
    });
  };
  const copyPluginAudit = async () => {
    try {
      const audit = await exportPluginRuns.mutateAsync({
        reviewState: pluginAuditFilter,
        limit: 40,
      });
      await copyJsonToClipboard(audit, "Plugin audit copied");
    } catch (error) {
      console.error("Plugin audit export failed", error);
      toast.error(
        error instanceof Error ? error.message : "Plugin audit export failed"
      );
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/20 p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(160px,220px)_minmax(160px,220px)_minmax(160px,220px)_1fr]">
          <div className="grid gap-1">
            <Label className="text-xs">Run Scheduling</Label>
            <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-3">
              <Switch
                checked={pluginSchedulingPolicy?.enabled ?? true}
                disabled={updatePluginSchedulingPolicy.isPending}
                onCheckedChange={(enabled) =>
                  updatePluginSchedulingPolicy.mutate({ enabled })
                }
                size="sm"
              />
              <span className="text-xs">
                {pluginSchedulingPolicy?.enabled === false ? "paused" : "enabled"}
              </span>
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Parallel Limit</Label>
            <Select
              disabled={updatePluginSchedulingPolicy.isPending}
              onValueChange={(value) =>
                updatePluginSchedulingPolicy.mutate({
                  maxConcurrentRuns: Number(value),
                })
              }
              value={String(pluginSchedulingPolicy?.maxConcurrentRuns ?? 1)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTOMATION_PARALLEL_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Cooldown</Label>
            <Select
              disabled={updatePluginSchedulingPolicy.isPending}
              onValueChange={(value) =>
                updatePluginSchedulingPolicy.mutate({ cooldownMs: Number(value) })
              }
              value={String(pluginSchedulingPolicy?.cooldownMs ?? 0)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTOMATION_COOLDOWN_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-end gap-1">
            <Badge
              variant={
                pluginSchedulingPolicy?.enabled === false ? "secondary" : "default"
              }
            >
              schedule{" "}
              {pluginSchedulingPolicy?.enabled === false ? "paused" : "enabled"}
            </Badge>
            <Badge variant="outline">
              parallel {pluginSchedulingPolicy?.maxConcurrentRuns ?? 1}
            </Badge>
            <Badge variant="outline">
              cooldown {pluginSchedulingPolicy?.cooldownMs ?? 0}ms
            </Badge>
            {pluginSchedulingPolicy?.updatedAt ? (
              <Badge variant="outline">
                updated {formatTime(pluginSchedulingPolicy.updatedAt)}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>
      {pluginDependencyGraph &&
      (pluginDependencyGraph.edges.length > 0 ||
        pluginDependencyGraph.diagnostics.length > 0) ? (
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium text-xs uppercase">
                Dependency Graph
              </span>
              <Badge variant="outline">
                {pluginDependencyGraph.edges.length} edges
              </Badge>
              {pluginDependencyGraph.diagnostics.length > 0 ? (
                <Badge variant="destructive">
                  {pluginDependencyGraph.diagnostics.length} issues
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {pluginDependencyGraph.nodes
              .filter(
                (node) =>
                  node.dependencyIds.length > 0 ||
                  node.dependentIds.length > 0 ||
                  node.status !== "ready"
              )
              .slice(0, 6)
              .map((node) => (
                <div className="rounded border bg-background/60 p-2" key={node.pluginId}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-xs">{node.pluginName}</span>
                    <Badge variant={statusVariant(node.status)}>{node.status}</Badge>
                    {node.dependencyIds.length > 0 ? (
                      <Badge variant="outline">deps {node.dependencyIds.length}</Badge>
                    ) : null}
                    {node.dependentIds.length > 0 ? (
                      <Badge variant="outline">used by {node.dependentIds.length}</Badge>
                    ) : null}
                  </div>
                  {node.dependencyNames.length > 0 ? (
                    <div className="mt-1 truncate text-muted-foreground text-[11px]">
                      needs {node.dependencyNames.join(", ")}
                    </div>
                  ) : null}
                  {node.dependentNames.length > 0 ? (
                    <div className="mt-1 truncate text-muted-foreground text-[11px]">
                      before {node.dependentNames.join(", ")}
                    </div>
                  ) : null}
                  {node.diagnostics.length > 0 ? (
                    <div className="mt-1 truncate text-destructive text-[11px]">
                      {node.diagnostics.slice(0, 2).join(" ")}
                    </div>
                  ) : null}
                </div>
              ))}
          </div>
          {pluginDependencyGraph.diagnostics.length > 0 ? (
            <div className="mt-2 line-clamp-2 text-destructive text-[11px]">
              {pluginDependencyGraph.diagnostics.slice(0, 3).join(" ")}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="rounded-md border bg-muted/20 p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,300px)_minmax(180px,220px)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-xs uppercase">Batch Queue</span>
              <Badge variant={pluginBatchCandidates.length > 0 ? "default" : "secondary"}>
                {pluginBatchCandidates.length} ready
              </Badge>
              {pluginBatchCandidates.length >= 8 ? (
                <Badge variant="outline">max 8</Badge>
              ) : null}
            </div>
            <div className="mt-1 truncate text-muted-foreground text-[11px]">
              {pluginBatchCandidates.length > 0
                ? pluginBatchCandidates.map((plugin) => plugin.name).join(", ")
                : "No trusted, granted, scheduling-ready plugins are available."}
            </div>
            {recentPluginBatches.length > 0 ? (
              <div className="mt-2 grid gap-1">
                {recentPluginBatches.slice(0, 3).map((batch) => (
                  <div
                    className="flex flex-wrap items-center gap-1.5 text-[11px]"
                    key={batch.id}
                  >
                    <Badge variant={statusVariant(batch.status)}>
                      {batch.status}
                    </Badge>
                    <span className="font-mono text-muted-foreground">
                      {batch.id}
                    </span>
                    <Badge variant="outline">{batch.failureMode}</Badge>
                    <span className="text-muted-foreground">
                      success {batch.counts.success}; failed {batch.counts.failed};
                      timeout {batch.counts.timeout}; disabled{" "}
                      {batch.counts.disabled}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Batch Confirmation</Label>
            <Input
              className="font-mono text-xs"
              onChange={(event) => setPluginBatchConfirmation(event.target.value)}
              placeholder="RUN PLUGIN BATCH"
              value={pluginBatchConfirmation}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Failure Mode</Label>
            <Select
              onValueChange={(value) =>
                setPluginBatchFailureMode(value as "continue" | "stop-on-failure")
              }
              value={pluginBatchFailureMode}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="continue">Continue</SelectItem>
                <SelectItem value="stop-on-failure">Stop on failure</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              disabled={
                runPluginBatch.isPending ||
                pluginBatchCandidates.length === 0 ||
                !pluginBatchConfirmed
              }
              onClick={runReadyPluginBatch}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Run Batch
            </Button>
          </div>
        </div>
        <div className="mt-3 grid gap-3 border-t pt-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-1">
            <Label className="text-xs">Save Ready Batch Preset</Label>
            <Input
              className="text-xs"
              onChange={(event) => setPluginBatchPresetName(event.target.value)}
              placeholder="Review + format"
              value={pluginBatchPresetName}
            />
          </div>
          <div className="flex items-end">
            <Button
              disabled={
                upsertPluginBatchPreset.isPending ||
                pluginBatchCandidates.length === 0 ||
                !pluginBatchPresetName.trim()
              }
              onClick={saveReadyPluginBatchPreset}
              size="sm"
              type="button"
              variant="outline"
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              Save Preset
            </Button>
          </div>
        </div>
        {pluginBatchPresets.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {pluginBatchPresets.slice(0, 4).map((preset) => {
              const presetPlugins = getPresetReadyPlugins(preset.pluginIds);
              const presetReady =
                presetPlugins.length === preset.pluginIds.length &&
                presetPlugins.every(isPluginReadyForBatch);
              return (
                <div
                  className="grid gap-2 rounded border bg-background/60 p-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                  key={preset.id}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-xs">{preset.name}</span>
                      <Badge variant={presetReady ? "default" : "secondary"}>
                        {presetReady ? "ready" : "needs review"}
                      </Badge>
                      <Badge variant="outline">{preset.failureMode}</Badge>
                      {preset.lastRunBatchId ? (
                        <Badge variant="outline">
                          last {preset.lastRunBatchId.slice(0, 18)}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 truncate text-muted-foreground text-[11px]">
                      {preset.pluginNames.join(", ")}
                    </div>
                    {preset.diagnostics.length > 0 ? (
                      <div className="mt-1 truncate text-muted-foreground text-[11px]">
                        {preset.diagnostics.slice(0, 2).join(" ")}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Button
                      disabled={
                        runPluginBatchPreset.isPending ||
                        !presetReady ||
                        !pluginBatchConfirmed
                      }
                      onClick={() => runSavedPluginBatchPreset(preset)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Play className="mr-1.5 h-3.5 w-3.5" />
                      Run
                    </Button>
                    <Button
                      disabled={deletePluginBatchPreset.isPending}
                      onClick={() =>
                        deletePluginBatchPreset.mutate({ presetId: preset.id })
                      }
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="mt-3 grid gap-3 border-t pt-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(170px,220px)_minmax(130px,170px)_auto]">
            <div className="grid gap-1">
              <Label className="text-xs">Scheduled Batch</Label>
              <Input
                className="text-xs"
                onChange={(event) =>
                  setPluginBatchScheduleName(event.target.value)
                }
                placeholder="Nightly review preset"
                value={pluginBatchScheduleName}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Preset</Label>
              <Select
                disabled={pluginBatchPresets.length === 0}
                onValueChange={setPluginBatchSchedulePresetId}
                value={
                  pluginBatchSchedulePresetId || pluginBatchPresets[0]?.id || ""
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select preset" />
                </SelectTrigger>
                <SelectContent>
                  {pluginBatchPresets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Interval</Label>
              <Select
                onValueChange={setPluginBatchScheduleIntervalMs}
                value={pluginBatchScheduleIntervalMs}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLUGIN_BATCH_SCHEDULE_INTERVAL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-1.5">
              <Button
                disabled={
                  upsertPluginBatchSchedule.isPending ||
                  pluginBatchPresets.length === 0 ||
                  !pluginBatchScheduleName.trim()
                }
                onClick={savePluginBatchSchedule}
                size="sm"
                type="button"
                variant="outline"
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Save Schedule
              </Button>
              <Button
                disabled={
                  runDuePluginBatchSchedules.isPending ||
                  duePluginBatchSchedules.length === 0
                }
                onClick={() => runDuePluginBatchSchedules.mutate({})}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Run Due
              </Button>
            </div>
          </div>
          {pluginBatchSchedules.length > 0 ? (
            <div className="grid gap-2">
              {pluginBatchSchedules.slice(0, 4).map((schedule) => (
                <div
                  className="grid gap-2 rounded border bg-background/60 p-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                  key={schedule.id}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={statusVariant(schedule.status)}>
                        {schedule.status}
                      </Badge>
                      <span className="font-medium text-xs">
                        {schedule.name}
                      </span>
                      <Badge variant="outline">
                        every {Math.round(schedule.intervalMs / 1000)}s
                      </Badge>
                      {schedule.lastRunStatus ? (
                        <Badge variant={statusVariant(schedule.lastRunStatus)}>
                          last {schedule.lastRunStatus}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 truncate text-muted-foreground text-[11px]">
                      {schedule.presetName ?? schedule.presetId} to{" "}
                      {schedule.pluginNames.join(", ") || "no plugins"}
                    </div>
                    <div className="mt-1 truncate text-muted-foreground text-[11px]">
                      next {formatTime(schedule.nextRunAt)}
                      {schedule.lastRunBatchId
                        ? `; last ${schedule.lastRunBatchId.slice(0, 18)}`
                        : ""}
                    </div>
                    {schedule.diagnostics.length > 0 ? (
                      <div className="mt-1 truncate text-muted-foreground text-[11px]">
                        {schedule.diagnostics.slice(0, 2).join(" ")}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                    <Button
                      disabled={
                        runDuePluginBatchSchedules.isPending ||
                        !schedule.enabled ||
                        Date.parse(schedule.nextRunAt) > Date.now()
                      }
                      onClick={() =>
                        runDuePluginBatchSchedules.mutate({
                          scheduleIds: [schedule.id],
                        })
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Play className="mr-1.5 h-3.5 w-3.5" />
                      Run
                    </Button>
                    <Button
                      disabled={deletePluginBatchSchedule.isPending}
                      onClick={() =>
                        deletePluginBatchSchedule.mutate({
                          scheduleId: schedule.id,
                        })
                      }
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="grid gap-2 rounded-md border bg-muted/20 p-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-1">
          <Label className="text-xs">Signed Package Manifest</Label>
          <Input
            className="font-mono text-xs"
            onChange={(event) => setPackageManifestPath(event.target.value)}
            placeholder=".eragear/plugin-packages/plugin.json"
            value={packageManifestPath}
          />
          <div className="truncate text-muted-foreground text-[11px]">
            Manifest must live inside the project root and include
            schemaVersion, publisher, publisherId, expiry metadata, publicKeyPem,
            signature, and plugin.
          </div>
        </div>
        <div className="flex items-end">
          <Button
            disabled={installPluginPackage.isPending}
            onClick={installSignedPackage}
            size="sm"
            type="button"
          >
            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
            Install Signed
          </Button>
        </div>
      </div>
      <div className="grid gap-2 rounded-md border bg-muted/20 p-3 lg:grid-cols-[minmax(140px,180px)_minmax(0,1fr)_minmax(150px,220px)_auto]">
        <div className="grid gap-1">
          <Label className="text-xs">Registry Name</Label>
          <Input
            className="text-xs"
            onChange={(event) => setPluginRegistryName(event.target.value)}
            placeholder="Team Registry"
            value={pluginRegistryName}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Signed Registry URL</Label>
          <Input
            className="font-mono text-xs"
            onChange={(event) => setPluginRegistryUrl(event.target.value)}
            placeholder="https://registry.example/plugins.json"
            value={pluginRegistryUrl}
          />
          <div className="truncate text-muted-foreground text-[11px]">
            Registry entries must pin signatureHash, publicKeyFingerprint, and
            can pin publisher identity plus expiry.
          </div>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Package ID</Label>
          <Input
            className="font-mono text-xs"
            onChange={(event) => setPluginRegistryPackageId(event.target.value)}
            placeholder="publisher.plugin"
            value={pluginRegistryPackageId}
          />
        </div>
        <div className="flex items-end gap-1.5">
          <Button
            disabled={upsertPluginRegistry.isPending}
            onClick={savePluginRegistry}
            size="sm"
            type="button"
            variant="outline"
          >
            Save
          </Button>
          <Button
            disabled={installPluginPackage.isPending}
            onClick={installRegistryPackage}
            size="sm"
            type="button"
            variant="secondary"
          >
            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
            Install Registry
          </Button>
        </div>
      </div>
      {pluginRegistries.length > 0 ? (
        <div className="rounded-md border">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="font-medium text-xs uppercase">
              Saved Signed Registries
            </span>
            <Badge variant="outline">{pluginRegistries.length}</Badge>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {pluginRegistries.map((registry) => (
              <div
                className="grid gap-2 border-b px-3 py-2 text-xs last:border-b-0"
                key={registry.id}
              >
                <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={statusVariant(registry.status)}>
                        {registry.status}
                      </Badge>
                      <Badge variant={statusVariant(registry.trustStatus)}>
                        {registry.trustStatus}
                      </Badge>
                      {registry.revokedSigners.length > 0 ? (
                        <Badge variant="destructive">
                          {registry.revokedSigners.length} revoked
                        </Badge>
                      ) : null}
                      <span className="min-w-0 truncate font-medium">
                        {registry.name}
                      </span>
                    </div>
                    <div
                      className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                      title={registry.url}
                    >
                      {registry.url}
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {registry.fingerprint}
                      {registry.lastRefreshAt
                        ? `; refreshed ${formatTime(registry.lastRefreshAt)}`
                        : ""}
                    </div>
                    {registry.diagnostics.length > 0 ? (
                      <div className="mt-1 text-muted-foreground text-[11px]">
                        {registry.diagnostics.slice(0, 2).join(" ")}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-start justify-end gap-1.5">
                    <Button
                      disabled={
                        trustPluginRegistry.isPending ||
                        registry.trustStatus === "trusted"
                      }
                      onClick={() =>
                        trustPluginRegistry.mutate({
                          registryId: registry.id,
                          fingerprint: registry.fingerprint,
                        })
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Trust
                    </Button>
                    <Button
                      disabled={
                        revokePluginRegistryTrust.isPending ||
                        registry.trustStatus !== "trusted"
                      }
                      onClick={() =>
                        revokePluginRegistryTrust.mutate({
                          registryId: registry.id,
                        })
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Revoke Trust
                    </Button>
                    <Button
                      disabled={
                        refreshPluginRegistry.isPending ||
                        registry.trustStatus !== "trusted" ||
                        !registry.enabled
                      }
                      onClick={() =>
                        refreshPluginRegistry.mutate({ registryId: registry.id })
                      }
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Refresh
                    </Button>
                  </div>
                </div>
                {registry.packages.length > 0 ? (
                  <div className="grid gap-1.5">
                    {registry.packages.map((item) => (
                      <div
                        className="grid gap-2 rounded-sm border bg-background/70 px-2 py-1.5 lg:grid-cols-[minmax(0,1fr)_auto]"
                        key={item.id}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant={statusVariant(item.status)}>
                              {item.status}
                            </Badge>
                            <Badge variant={statusVariant(item.signingStatus)}>
                              signer {item.signingStatus}
                            </Badge>
                            {item.publisher ? (
                              <Badge variant="outline">{item.publisher}</Badge>
                            ) : null}
                            {item.publisherId ? (
                              <Badge variant="outline">{item.publisherId}</Badge>
                            ) : null}
                            <Badge variant={statusVariant(item.expiryStatus)}>
                              expiry {item.expiryStatus}
                            </Badge>
                            <span className="truncate font-medium">
                              {item.name ?? item.id}
                            </span>
                          </div>
                          <div
                            className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                            title={item.manifestUrl}
                          >
                            {item.manifestUrl}
                          </div>
                          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                            {item.signatureHash}
                          </div>
                          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                            {item.publicKeyFingerprint}
                          </div>
                          <div className="mt-1 truncate text-muted-foreground text-[11px]">
                            {item.issuedAt ? `issued ${formatTime(item.issuedAt)}; ` : ""}
                            {item.expiresAt
                              ? `expires ${formatTime(item.expiresAt)}`
                              : "expiry not declared"}
                          </div>
                          {item.revocationReason ? (
                            <div className="mt-1 text-destructive text-[11px]">
                              {item.revocationReason}
                            </div>
                          ) : null}
                          {item.revocationSource ? (
                            <div className="mt-1 text-destructive text-[11px]">
                              revoked by {item.revocationSource}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {item.signingStatus === "revoked" &&
                          item.revocationSource !== "registry" ? (
                            <Button
                              disabled={restorePluginRegistrySigner.isPending}
                              onClick={() =>
                                restorePluginRegistrySigner.mutate({
                                  registryId: registry.id,
                                  publicKeyFingerprint: item.publicKeyFingerprint,
                                })
                              }
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              Restore signer
                            </Button>
                          ) : item.signingStatus === "revoked" ? null : (
                            <Button
                              disabled={revokePluginRegistrySigner.isPending}
                              onClick={() =>
                                revokePluginRegistrySigner.mutate({
                                  registryId: registry.id,
                                  publicKeyFingerprint: item.publicKeyFingerprint,
                                  reason: `Revoked from ${registry.name}`,
                                })
                              }
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              Revoke signer
                            </Button>
                          )}
                          <Button
                            disabled={
                              installPluginRegistryPackage.isPending ||
                              item.status === "invalid" ||
                              item.status === "revoked" ||
                              item.status === "installed" ||
                              item.expiryStatus === "expired"
                            }
                            onClick={() =>
                              installPluginRegistryPackage.mutate({
                                registryId: registry.id,
                                packageId: item.id,
                              })
                            }
                            size="sm"
                            type="button"
                            variant={
                              item.status === "update-available"
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {item.status === "update-available"
                              ? "Update"
                              : "Install"}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {pluginCatalog.length > 0 ? (
        <div className="rounded-md border">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="font-medium text-xs uppercase">
              Signed Package Catalog
            </span>
            <Badge variant="outline">{pluginCatalog.length}</Badge>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {pluginCatalog.map((item) => (
              <div
                className="grid gap-2 border-b px-3 py-2 text-xs last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto]"
                key={item.manifestPath}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={statusVariant(item.status)}>
                      {item.status}
                    </Badge>
                    {item.publisher ? (
                      <Badge variant="outline">{item.publisher}</Badge>
                    ) : null}
                    {item.publisherId ? (
                      <Badge variant="outline">{item.publisherId}</Badge>
                    ) : null}
                    <Badge variant={statusVariant(item.expiryStatus)}>
                      expiry {item.expiryStatus}
                    </Badge>
                    <span className="min-w-0 truncate font-medium">
                      {item.name ?? item.id ?? item.manifestPath}
                    </span>
                  </div>
                  {item.description ? (
                    <div
                      className="mt-1 truncate text-muted-foreground"
                      title={item.description}
                    >
                      {item.description}
                    </div>
                  ) : null}
                  <div
                    className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                    title={item.manifestPath}
                  >
                    {item.manifestPath}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-muted-foreground text-[11px]">
                    <Badge variant="outline">{item.workspaceAccess}</Badge>
                    {item.scopes.map((scope) => (
                      <Badge key={scope} variant="outline">
                        {scope}
                      </Badge>
                    ))}
                    {item.envKeys.length > 0 ? (
                      <Badge variant="outline">
                        env {item.envKeys.length}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate text-muted-foreground text-[11px]">
                    {item.issuedAt ? `issued ${formatTime(item.issuedAt)}; ` : ""}
                    {item.expiresAt
                      ? `expires ${formatTime(item.expiresAt)}`
                      : "expiry not declared"}
                  </div>
                  {item.diagnostics.length > 0 ? (
                    <div className="mt-1 text-muted-foreground text-[11px]">
                      {item.diagnostics.slice(0, 2).join(" ")}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center justify-end">
                  <Button
                    disabled={
                      installPluginPackage.isPending ||
                      item.status === "invalid" ||
                      item.status === "installed" ||
                      item.expiryStatus === "expired"
                    }
                    onClick={() =>
                      installPluginPackage.mutate({
                        manifestPath: item.manifestPath,
                      })
                    }
                    size="sm"
                    type="button"
                    variant={
                      item.status === "update-available" ? "secondary" : "outline"
                    }
                  >
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                    {item.status === "update-available" ? "Update" : "Install"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid gap-2 xl:grid-cols-[1fr_1fr_150px_1fr_90px]">
        <div className="grid gap-1">
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Description</Label>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Policy</Label>
          <Select
            onValueChange={(value) => {
              const next = value as ExecutionPolicyPreset;
              setPolicyPreset(next);
              if (next === "restricted") {
                setProjectRootAccess(false);
                setWorkingDirectory("");
              }
            }}
            value={policyPreset}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXECUTION_POLICY_PRESET_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Command</Label>
          <Input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Timeout</Label>
          <Input
            inputMode="numeric"
            value={timeoutMs}
            onChange={(event) => setTimeoutMs(event.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <div className="grid gap-1">
          <Label className="text-xs">Args</Label>
          <Textarea
            className="min-h-20 resize-y font-mono text-xs"
            onChange={(event) => setArgsText(event.target.value)}
            placeholder="one argument per line"
            value={argsText}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Env Keys</Label>
          <Textarea
            className="min-h-20 resize-y font-mono text-xs"
            onChange={(event) => setEnvKeysText(event.target.value)}
            placeholder="optional env key allowlist"
            value={envKeysText}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Dependencies</Label>
          <Textarea
            className="min-h-20 resize-y font-mono text-xs"
            onChange={(event) => setDependencyIdsText(event.target.value)}
            placeholder="plugin ids"
            value={dependencyIdsText}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Working Directory</Label>
          <Input
            disabled={!projectRootAccess || policyPreset === "restricted"}
            onChange={(event) => setWorkingDirectory(event.target.value)}
            placeholder={
              policyPreset === "restricted"
                ? "restricted policy forces sandbox"
                : projectRootAccess
                ? "relative to project root"
                : "disabled without workspace access"
            }
            value={workingDirectory}
          />
          <div className="truncate text-muted-foreground text-[11px]">
            {policyPreset === "restricted"
              ? "Restricted policy forces temporary sandbox cwd."
              : projectRootAccess
              ? shortPath(snapshot?.plugins.configPath)
              : "Runs in temporary sandbox cwd; project root is hidden."}
          </div>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Workspace Access</Label>
          <div className="flex h-9 items-center gap-2 rounded-md border px-3">
            <Switch
              checked={policyPreset === "restricted" ? false : projectRootAccess}
              disabled={policyPreset === "restricted"}
              onCheckedChange={(checked) => {
                setProjectRootAccess(checked);
                if (!checked) {
                  setWorkingDirectory("");
                }
              }}
              size="sm"
            />
            <span className="text-xs">
              {policyPreset === "restricted"
                ? "forced sandbox"
                : projectRootAccess
                  ? "project root"
                  : "sandbox cwd"}
            </span>
          </div>
        </div>
        <div className="flex items-end">
          <Button disabled={upsertPlugin.isPending} onClick={save} size="sm">
            Save Plugin
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        {plugins.map((plugin) => {
          const runConfirmation = runConfirmations[plugin.id]?.trim() ?? "";
          const runConfirmed = runConfirmation === plugin.runConfirmationToken;
          const runApproved =
            plugin.runOperation.approvalStatus === "approved" &&
            Boolean(plugin.runOperation.approvalId);
          return (
          <div className="rounded-md border p-3" key={plugin.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-sm">{plugin.name}</span>
                  <Badge variant={plugin.enabled ? "default" : "outline"}>
                    {plugin.enabled ? "enabled" : "off"}
                  </Badge>
                  <Badge variant={statusVariant(plugin.trustStatus)}>
                    {plugin.trustStatus}
                  </Badge>
                  <Badge
                    variant={
                      plugin.policyPreset === "standard" ? "outline" : "secondary"
                    }
                  >
                    policy {plugin.policyPreset}
                  </Badge>
                  <Badge variant={statusVariant(plugin.permissionStatus)}>
                    permissions {plugin.permissionStatus}
                  </Badge>
                  <Badge variant={statusVariant(plugin.runOperation.approvalStatus)}>
                    run {plugin.runOperation.approvalStatus}
                  </Badge>
                  <Badge variant={statusVariant(plugin.scheduling.status)}>
                    schedule {plugin.scheduling.status}
                  </Badge>
                  <Badge variant={statusVariant(plugin.executionPolicy.status)}>
                    sandbox {plugin.executionPolicy.status}
                  </Badge>
                  <Badge variant="outline">
                    tree {plugin.executionPolicy.isolation.processTreeKill}
                  </Badge>
                  {plugin.installSource === "signed-package" ? (
                    <Badge variant="default">signed</Badge>
                  ) : null}
                  {plugin.packageGovernanceStatus ? (
                    <Badge variant={statusVariant(plugin.packageGovernanceStatus)}>
                      package {plugin.packageGovernanceStatus}
                    </Badge>
                  ) : null}
                  {plugin.scopes.map((scope) => (
                    <Badge key={scope} variant="outline">
                      {scope}
                    </Badge>
                  ))}
                  {plugin.dependencyIds.length > 0 ? (
                    <Badge variant="outline">deps {plugin.dependencyIds.length}</Badge>
                  ) : null}
                  <Badge variant={plugin.envKeys.length > 0 ? "secondary" : "outline"}>
                    {plugin.envKeys.length > 0
                      ? `${plugin.envKeys.length} env keys`
                      : "isolated env"}
                  </Badge>
                  {plugin.lastRun ? (
                    <Badge variant={statusVariant(plugin.lastRun.status)}>
                      {plugin.lastRun.status}
                    </Badge>
                  ) : null}
                  {plugin.lastRun ? (
                    <Badge
                      variant={plugin.lastRun.reviewedAt ? "default" : "secondary"}
                    >
                      {plugin.lastRun.reviewedAt ? "reviewed" : "open"}
                    </Badge>
                  ) : null}
                </div>
                {plugin.description ? (
                  <div className="mt-1 line-clamp-2 text-muted-foreground text-xs">
                    {plugin.description}
                  </div>
                ) : null}
                <div className="mt-1 truncate font-mono text-muted-foreground text-xs">
                  {plugin.command}
                  {plugin.args.length > 0 ? ` ${plugin.args.join(" ")}` : ""}
                </div>
                <div className="mt-1 truncate text-muted-foreground text-[11px]">
                  {plugin.workingDirectory
                    ? `cwd ${plugin.workingDirectory}; `
                    : plugin.scopes.includes("project-root")
                      ? "cwd project root; "
                      : "cwd temp sandbox; project root hidden; "}
                  timeout {plugin.timeoutMs}ms
                </div>
                <div className="mt-1 truncate text-muted-foreground text-[11px]">
                  env {plugin.envKeys.length > 0 ? plugin.envKeys.join(", ") : "none"}
                </div>
                <div className="mt-1 truncate text-muted-foreground text-[11px]">
                  isolation {plugin.runOperation.isolation.mode}; cwd{" "}
                  {plugin.runOperation.isolation.cwdScope}; root{" "}
                  {plugin.runOperation.isolation.projectRootExposed
                    ? "exposed"
                    : "hidden"}
                </div>
                {plugin.dependencyIds.length > 0 ? (
                  <div className="mt-1 truncate text-muted-foreground text-[11px]">
                    deps {plugin.dependencyIds.join(", ")}
                  </div>
                ) : null}
                {plugin.installSource === "signed-package" ? (
                  <div className="mt-1 grid gap-1 text-muted-foreground text-[11px]">
                    <div className="truncate">
                      publisher {plugin.publisher ?? "unknown"}
                      {plugin.packagePublisherId
                        ? `; identity ${plugin.packagePublisherId}`
                        : ""}
                      {plugin.packageVerifiedAt
                        ? `; verified ${formatTime(plugin.packageVerifiedAt)}`
                        : ""}
                    </div>
                    <div className="truncate">
                      expiry {plugin.packageExpiryStatus ?? "not-declared"}
                      {plugin.packageIssuedAt
                        ? `; issued ${formatTime(plugin.packageIssuedAt)}`
                        : ""}
                      {plugin.packageExpiresAt
                        ? `; expires ${formatTime(plugin.packageExpiresAt)}`
                        : ""}
                    </div>
                    <div className="truncate">
                      governance {plugin.packageGovernanceStatus ?? "verified"}
                      {plugin.packageGovernanceDiagnostics?.length
                        ? `; ${plugin.packageGovernanceDiagnostics[0]}`
                        : ""}
                    </div>
                    {plugin.packageRegistryName || plugin.packageRegistryPackageId ? (
                      <div className="truncate">
                        registry {plugin.packageRegistryName ?? "remote"}
                        {plugin.packageRegistryPackageId
                          ? ` / ${plugin.packageRegistryPackageId}`
                          : ""}
                      </div>
                    ) : null}
                    <div className="truncate font-mono">
                      {plugin.packageSignatureHash ?? "signature hash unavailable"}
                    </div>
                    {plugin.packageRegistryUrl ? (
                      <div className="truncate font-mono">
                        {plugin.packageRegistryUrl}
                      </div>
                    ) : null}
                    {plugin.packageManifestPath ? (
                      <div className="truncate font-mono">
                        {plugin.packageManifestPath}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-1 truncate font-mono text-muted-foreground text-[11px]">
                  {plugin.fingerprint}
                  {plugin.trustedAt ? `; trusted ${formatTime(plugin.trustedAt)}` : ""}
                </div>
                <div className="mt-1 truncate font-mono text-muted-foreground text-[11px]">
                  {plugin.permissionFingerprint}
                  {plugin.permissionGrantedAt
                    ? `; permissions ${formatTime(plugin.permissionGrantedAt)}`
                    : ""}
                </div>
                <div className="mt-1 grid gap-1 text-muted-foreground text-[11px]">
                  <div className="truncate font-mono">
                    {plugin.runOperation.fingerprint}
                    {plugin.runOperation.expiresAt
                      ? `; approval expires ${formatTime(plugin.runOperation.expiresAt)}`
                      : ""}
                  </div>
                  <div className="truncate">
                    operation {plugin.runOperation.workspaceAccess}; cwd{" "}
                    {plugin.runOperation.cwd}; approval{" "}
                    {plugin.runOperation.approvalStatus}
                  </div>
                  <div className="truncate">
                    schedule active {plugin.scheduling.activeRuns}/
                    {plugin.scheduling.maxConcurrentRuns}; cooldown{" "}
                    {plugin.scheduling.cooldownMs}ms
                    {plugin.scheduling.nextAllowedAt
                      ? `; next ${formatTime(plugin.scheduling.nextAllowedAt)}`
                      : ""}
                  </div>
                </div>
                {plugin.executionPolicy.blockers.length > 0 ? (
                  <div className="mt-1 line-clamp-2 text-destructive text-[11px]">
                    {plugin.executionPolicy.blockers.join(" ")}
                  </div>
                ) : null}
              </div>
              <div className="grid w-56 shrink-0 gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs">Run Confirmation</Label>
                  <Input
                    aria-label={`Run confirmation for ${plugin.name}`}
                    className="font-mono text-xs"
                    onChange={(event) =>
                      setRunConfirmations((current) => ({
                        ...current,
                        [plugin.id]: event.target.value,
                      }))
                    }
                    placeholder={plugin.runConfirmationToken}
                    value={runConfirmations[plugin.id] ?? ""}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={
                    trustPlugin.isPending || plugin.trustStatus === "trusted"
                  }
                  onClick={() =>
                    trustPlugin.mutate({
                      pluginId: plugin.id,
                      fingerprint: plugin.fingerprint,
                    })
                  }
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Trust
                </Button>
                <Button
                  disabled={updatePluginPermissionGrant.isPending}
                  onClick={() =>
                    updatePluginPermissionGrant.mutate({
                      pluginId: plugin.id,
                      permissionFingerprint: plugin.permissionFingerprint,
                      granted: plugin.permissionStatus !== "granted",
                    })
                  }
                  size="sm"
                  type="button"
                  variant={
                    plugin.permissionStatus === "granted" ? "ghost" : "secondary"
                  }
                >
                  {plugin.permissionStatus === "granted" ? "Revoke" : "Grant"}
                </Button>
                {plugin.installSource === "signed-package" ? (
                  <Button
                    disabled={revalidatePluginPackage.isPending}
                    onClick={() =>
                      revalidatePluginPackage.mutate({ pluginId: plugin.id })
                    }
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
                    Revalidate
                  </Button>
                ) : null}
                <Button
                  disabled={
                    approvePluginRun.isPending ||
                    !plugin.enabled ||
                    plugin.trustStatus !== "trusted" ||
                    plugin.permissionStatus !== "granted" ||
                    plugin.executionPolicy.status !== "allowed" ||
                    plugin.scheduling.status !== "ready" ||
                    plugin.packageExpiryStatus === "expired" ||
                    plugin.packageGovernanceStatus === "verification-failed" ||
                    plugin.runOperation.approvalStatus === "approved"
                  }
                  onClick={() =>
                    approvePluginRun.mutate({
                      pluginId: plugin.id,
                      operationFingerprint: plugin.runOperation.fingerprint,
                    })
                  }
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Approve run
                </Button>
                <Button
                  disabled={
                    runPlugin.isPending ||
                    !plugin.enabled ||
                    plugin.trustStatus !== "trusted" ||
                    plugin.permissionStatus !== "granted" ||
                    plugin.executionPolicy.status !== "allowed" ||
                    plugin.scheduling.status !== "ready" ||
                    plugin.packageGovernanceStatus === "verification-failed" ||
                    !runApproved ||
                    !runConfirmed
                  }
                  onClick={() =>
                    runPlugin.mutate({
                      pluginId: plugin.id,
                      confirmation: runConfirmation,
                      operationApprovalId: plugin.runOperation.approvalId ?? "",
                    })
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Run
                </Button>
                <Switch
                  checked={plugin.enabled}
                  disabled={togglePlugin.isPending}
                  onCheckedChange={(enabled) =>
                    togglePlugin.mutate({ id: plugin.id, enabled })
                  }
                  size="sm"
                />
                </div>
              </div>
            </div>
            {plugin.lastRun ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-muted-foreground text-[11px]">
                    Last run {formatTime(plugin.lastRun.finishedAt)} -{" "}
                    {plugin.lastRun.durationMs}ms
                    {plugin.lastRun.batchId ? `; batch ${plugin.lastRun.batchId}` : ""}
                  </div>
                  <Button
                    disabled={reviewPluginRun.isPending}
                    onClick={() =>
                      reviewPluginRun.mutate({
                        runId: plugin.lastRun!.id,
                        reviewed: !plugin.lastRun!.reviewedAt,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {plugin.lastRun.reviewedAt ? (
                      <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                    ) : (
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {plugin.lastRun.reviewedAt ? "Reopen" : "Review"}
                  </Button>
                </div>
                <div className="grid gap-2 xl:grid-cols-2">
                  <div className="min-w-0 rounded bg-muted/30 p-2">
                    <div className="mb-1 text-muted-foreground text-[11px]">
                      stdout
                    </div>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
                      {plugin.lastRun.stdout || "No stdout"}
                    </pre>
                  </div>
                  <div className="min-w-0 rounded bg-muted/30 p-2">
                    <div className="mb-1 text-muted-foreground text-[11px]">
                      stderr / diagnostics
                    </div>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
                      {plugin.lastRun.stderr ||
                        plugin.lastRun.diagnostics.slice(0, 3).join("\n") ||
                        "No stderr"}
                    </pre>
                  </div>
                </div>
                {plugin.lastRun.preRunCheckpointId ||
                plugin.lastRun.postRunCheckpointId ||
                (plugin.lastRun.workspaceChangedFiles?.length ?? 0) > 0 ? (
                  <div className="rounded border bg-background/60 p-2">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-medium text-xs">Workspace audit</span>
                      {plugin.lastRun.preRunCheckpointId ? (
                        <Badge variant="outline">
                          pre {plugin.lastRun.preRunCheckpointId.slice(0, 18)}
                        </Badge>
                      ) : null}
                      {plugin.lastRun.postRunCheckpointId ? (
                        <Badge variant="secondary">
                          post {plugin.lastRun.postRunCheckpointId.slice(0, 18)}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground text-[11px]">
                      before {plugin.lastRun.workspaceStatusBefore?.length ?? 0}
                      {" -> "}after{" "}
                      {plugin.lastRun.workspaceStatusAfter?.length ?? 0}
                    </div>
                    {(plugin.lastRun.workspaceChangedFiles?.length ?? 0) > 0 ? (
                      <div className="mt-1 truncate font-mono text-[11px]">
                        {plugin.lastRun.workspaceChangedFiles?.join(", ")}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          );
        })}
        {plugins.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
            No plugins configured. Add a project-local plugin to create an
            executable plugin surface.
          </div>
        ) : null}
      </div>
      {recentPluginRuns.length > 0 ? (
        <div className="rounded-md border bg-muted/20">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <div className="font-medium text-sm">Run Audit</div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                onValueChange={(value) =>
                  setPluginAuditFilter(value as AuditReviewState)
                }
                value={pluginAuditFilter}
              >
                <SelectTrigger className="h-8 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIT_REVIEW_FILTERS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={exportPluginRuns.isPending}
                onClick={() => {
                  void copyPluginAudit();
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copy Audit
              </Button>
              <Badge variant="outline">
                {visiblePluginRuns.length}/{recentPluginRuns.length} runs
              </Badge>
            </div>
          </div>
          <div className="divide-y">
            {visiblePluginRuns.slice(0, 8).map((run) => (
              <div
                className="grid gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                key={run.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-xs">
                      {run.pluginName}
                    </span>
                    <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                    <Badge variant={run.reviewedAt ? "default" : "secondary"}>
                      {run.reviewedAt ? "reviewed" : "open"}
                    </Badge>
                    {run.postRunCheckpointId ? (
                      <Badge variant="outline">checkpoint</Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate text-muted-foreground text-[11px]">
                    {formatTime(run.finishedAt)} - {run.durationMs}ms
                  </div>
                  {(run.workspaceChangedFiles?.length ?? 0) > 0 ? (
                    <div className="mt-1 truncate font-mono text-muted-foreground text-[11px]">
                      workspace {run.workspaceChangedFiles?.join(", ")}
                    </div>
                  ) : null}
                  <div className="mt-1 truncate font-mono text-muted-foreground text-[11px]">
                    {run.stdout ||
                      run.stderr ||
                      run.diagnostics.slice(0, 1).join(" ") ||
                      "No output"}
                  </div>
                </div>
                <div className="flex items-center sm:justify-end">
                  <Button
                    disabled={reviewPluginRun.isPending}
                    onClick={() =>
                      reviewPluginRun.mutate({
                        runId: run.id,
                        reviewed: !run.reviewedAt,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {run.reviewedAt ? (
                      <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                    ) : (
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {run.reviewedAt ? "Reopen" : "Review"}
                  </Button>
                </div>
              </div>
            ))}
            {visiblePluginRuns.length === 0 ? (
              <div className="px-3 py-2 text-muted-foreground text-xs">
                No plugin runs match this audit filter.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProjectIndex({ snapshot }: { snapshot: LocalAdeSnapshot | undefined }) {
  const utils = trpc.useUtils();
  const refreshIndex = trpc.settings.refreshProjectIndex.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Project index refreshed");
    },
    onError: (error) => toast.error(error.message),
  });
  const index = snapshot?.projectIndex;
  const files = index?.files ?? [];
  const symbols = index?.symbols ?? [];
  const tasks = index?.tasks ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm">Repo Snapshot</div>
          <div className="truncate text-muted-foreground text-xs">
            {shortPath(index?.storagePath)} - {index?.indexedAt ? `indexed ${formatTime(index.indexedAt)}` : "not indexed"}
          </div>
        </div>
        <Button
          disabled={refreshIndex.isPending}
          onClick={() => refreshIndex.mutate({})}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Refresh Index
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <StatTile
          detail={`${formatBytes(index?.totalBytes)} tracked by metadata`}
          icon={FileText}
          label="Indexed Files"
          value={index?.indexedFiles ?? 0}
        />
        <StatTile
          detail={(index?.extensions ?? [])
            .slice(0, 3)
            .map((item) => `${item.extension} ${item.count}`)
            .join(", ") || "No extension summary"}
          icon={Database}
          label="Extensions"
          value={index?.extensions.length ?? 0}
        />
        <StatTile
          detail={symbols.slice(0, 2).map((item) => item.name).join(", ") || "No symbols"}
          icon={SlidersHorizontal}
          label="Symbols"
          value={symbols.length}
        />
        <StatTile
          detail={tasks.slice(0, 2).map((item) => `${item.marker} ${item.path}`).join(", ") || "No tasks"}
          icon={ShieldAlert}
          label="Tasks"
          value={tasks.length}
        />
        <StatTile
          detail={
            index?.semantic
              ? index.semantic.source === "model-embedding"
                ? `${index.semantic.embeddedFiles ?? 0} embedded / ${
                    index.semantic.dimensions ?? 0
                  }d / ${index.semantic.model ?? "model"}`
                : `${index.semantic.profiledFiles} files / ${index.semantic.tokenCount} tokens`
              : "Local semantic profile not built"
          }
          icon={SlidersHorizontal}
          label="Semantic"
          value={
            index?.semantic.source === "model-embedding"
              ? "embedding"
              : (index?.semantic.status ?? "empty")
          }
        />
        <StatTile
          detail={
            index?.indexedAt
              ? "Normal chat prompts attach top matches automatically"
              : "Refresh index, then use /index or normal prompts"
          }
          icon={MessageSquare}
          label="Chat Context"
          value={index?.indexedAt ? "auto" : "manual"}
        />
      </div>
      {(index?.extensions.length ?? 0) > 0 ? (
        <div className="flex flex-wrap gap-1">
          {(index?.extensions ?? []).map((item) => (
            <Badge key={item.extension} variant="outline">
              {item.extension} {item.count}
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="grid gap-2 xl:grid-cols-2">
        <div className="overflow-hidden rounded-md border">
          <div className="border-b bg-muted/30 px-3 py-2 font-medium text-xs">
            Code Symbols
          </div>
          <div className="max-h-44 overflow-y-auto">
            {symbols.slice(0, 12).map((symbol) => (
              <div
                className="grid grid-cols-[88px_1fr_56px] gap-2 border-b px-3 py-1.5 text-xs last:border-b-0"
                key={`${symbol.path}:${symbol.line}:${symbol.name}`}
              >
                <span className="truncate text-muted-foreground">{symbol.kind}</span>
                <span className="truncate font-mono" title={`${symbol.path}:${symbol.line}`}>
                  {symbol.name}
                </span>
                <span className="text-muted-foreground">L{symbol.line}</span>
              </div>
            ))}
            {symbols.length === 0 ? (
              <div className="p-3 text-muted-foreground text-sm">
                Refresh the project index to inspect code symbols.
              </div>
            ) : null}
          </div>
        </div>
        <div className="overflow-hidden rounded-md border">
          <div className="border-b bg-muted/30 px-3 py-2 font-medium text-xs">
            Task Markers
          </div>
          <div className="max-h-44 overflow-y-auto">
            {tasks.slice(0, 12).map((task) => (
              <div
                className="grid grid-cols-[64px_1fr_56px] gap-2 border-b px-3 py-1.5 text-xs last:border-b-0"
                key={`${task.path}:${task.line}:${task.marker}`}
              >
                <Badge variant="outline">{task.marker}</Badge>
                <span className="truncate" title={`${task.path}: ${task.text}`}>
                  {task.text || task.path}
                </span>
                <span className="text-muted-foreground">L{task.line}</span>
              </div>
            ))}
            {tasks.length === 0 ? (
              <div className="p-3 text-muted-foreground text-sm">
                No TODO/FIXME/HACK/BUG/XXX markers indexed.
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border">
        <div className="grid grid-cols-[1fr_90px_96px] border-b bg-muted/30 px-3 py-2 font-medium text-xs">
          <span>Path</span>
          <span>Size</span>
          <span>Type</span>
        </div>
        <div className="max-h-56 overflow-y-auto">
          {files.map((file) => (
            <div
              className="grid grid-cols-[1fr_90px_96px] gap-2 border-b px-3 py-1.5 text-xs last:border-b-0"
              key={file.path}
            >
              <span className="truncate font-mono" title={file.path}>
                {file.path}
              </span>
              <span className="text-muted-foreground">{formatBytes(file.sizeBytes)}</span>
              <span className="truncate text-muted-foreground">
                {file.language ?? file.extension}
              </span>
            </div>
          ))}
          {files.length === 0 ? (
            <div className="p-3 text-muted-foreground text-sm">
              Refresh the project index to inspect repository metadata.
            </div>
          ) : null}
        </div>
      </div>
      {(index?.diagnostics ?? []).slice(1, 4).map((diagnostic) => (
        <div className="rounded-md border bg-muted/20 p-2 text-muted-foreground text-xs" key={diagnostic}>
          {diagnostic}
        </div>
      ))}
    </div>
  );
}

function MemoryAndTrust({ snapshot }: { snapshot: LocalAdeSnapshot | undefined }) {
  const utils = trpc.useUtils();
  const memorySources = snapshot?.projectMemory.sources ?? [];
  const memoryPresets = snapshot?.projectMemory.presets ?? [];
  const [memoryPresetName, setMemoryPresetName] = React.useState("");
  const [memoryPresetQuery, setMemoryPresetQuery] = React.useState("");
  const [memoryPresetMaxBytes, setMemoryPresetMaxBytes] = React.useState("12000");
  const [memoryPresetRetrievalMode, setMemoryPresetRetrievalMode] =
    React.useState<"full" | "semantic">("full");
  const [memoryPresetMaxChunks, setMemoryPresetMaxChunks] = React.useState("4");
  const [memoryPresetSourcePaths, setMemoryPresetSourcePaths] = React.useState<
    string[]
  >([]);
  const [checkpointPreview, setCheckpointPreview] =
    React.useState<CheckpointPreview | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = React.useState("");
  const [selectedCheckpointFiles, setSelectedCheckpointFiles] = React.useState<
    string[]
  >([]);
  const [selectedCheckpointHunks, setSelectedCheckpointHunks] = React.useState<
    CheckpointHunkSelection[]
  >([]);
  const selectedCheckpointFileSet = React.useMemo(
    () => new Set(selectedCheckpointFiles),
    [selectedCheckpointFiles]
  );
  const selectedCheckpointHunkSet = React.useMemo(
    () => new Set(selectedCheckpointHunks.map(checkpointHunkSelectionKey)),
    [selectedCheckpointHunks]
  );
  const checkpointRiskByFile = React.useMemo(() => {
    const result = new Map<string, CheckpointPreview["restoreRisks"][number]>();
    for (const risk of checkpointPreview?.restoreRisks ?? []) {
      result.set(risk.file, risk);
    }
    return result;
  }, [checkpointPreview]);
  const checkpointRestorePlan = React.useMemo(
    () => getLocalAdeCheckpointRestorePlan(checkpointPreview),
    [checkpointPreview]
  );
  const checkpointTrackedConflictFileSet = React.useMemo(
    () => new Set(checkpointRestorePlan.trackedConflictFiles),
    [checkpointRestorePlan]
  );
  const checkpointTrackedConflictHunkCounts = React.useMemo(() => {
    const result = new Map<string, number>();
    for (const file of checkpointPreview?.diffFiles ?? []) {
      if (checkpointTrackedConflictFileSet.has(file.path)) {
        result.set(file.path, file.hunks.length);
      }
    }
    return result;
  }, [checkpointPreview, checkpointTrackedConflictFileSet]);
  const selectedSafeCheckpointHunks = React.useMemo(
    () =>
      selectedCheckpointHunks.filter(
        (hunk) => checkpointRiskByFile.get(hunk.file)?.level === "safe"
      ),
    [checkpointRiskByFile, selectedCheckpointHunks]
  );
  const selectedTrackedConflictHunks = React.useMemo(
    () =>
      selectedCheckpointHunks.filter((hunk) =>
        checkpointTrackedConflictFileSet.has(hunk.file)
      ),
    [checkpointTrackedConflictFileSet, selectedCheckpointHunks]
  );
  const selectedTrackedConflictHunkCounts = React.useMemo(() => {
    const result = new Map<string, number>();
    for (const hunk of selectedTrackedConflictHunks) {
      result.set(hunk.file, (result.get(hunk.file) ?? 0) + 1);
    }
    return result;
  }, [selectedTrackedConflictHunks]);
  const canApplySelectedTrackedConflictHunks = React.useMemo(
    () =>
      selectedTrackedConflictHunks.length > 0 &&
      Array.from(selectedTrackedConflictHunkCounts).every(
        ([file, selectedCount]) =>
          selectedCount > 0 &&
          selectedCount < (checkpointTrackedConflictHunkCounts.get(file) ?? 0)
      ),
    [
      checkpointTrackedConflictHunkCounts,
      selectedTrackedConflictHunkCounts,
      selectedTrackedConflictHunks.length,
    ]
  );
  const isCheckpointHunkSelectable = React.useCallback(
    (file: string) =>
      checkpointRiskByFile.get(file)?.level === "safe" ||
      checkpointTrackedConflictFileSet.has(file),
    [checkpointRiskByFile, checkpointTrackedConflictFileSet]
  );
  const checkpointConflictEditor = React.useMemo(
    () =>
      getLocalAdeCheckpointConflictEditorState({
        preview: checkpointPreview,
        selectedFiles: selectedCheckpointFiles,
        selectedHunks: selectedCheckpointHunks,
      }),
    [checkpointPreview, selectedCheckpointFiles, selectedCheckpointHunks]
  );
  const checkpointVisualMerge = React.useMemo(
    () =>
      getLocalAdeCheckpointVisualMergeState({
        preview: checkpointPreview,
        selectedFiles: selectedCheckpointFiles,
        selectedHunks: selectedCheckpointHunks,
      }),
    [checkpointPreview, selectedCheckpointFiles, selectedCheckpointHunks]
  );
  const checkpointRestoreConfirmed = checkpointPreview
    ? restoreConfirmation.trim() === checkpointPreview.restoreToken
    : false;
  const updateMemory = trpc.settings.updateCapabilityState.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
    },
    onError: (error) => toast.error(error.message),
  });
  const upsertProjectMemoryPreset =
    trpc.settings.upsertProjectMemoryPreset.useMutation({
      onSuccess: (data) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        setMemoryPresetName("");
        setMemoryPresetQuery("");
        setMemoryPresetMaxBytes("12000");
        setMemoryPresetRetrievalMode("full");
        setMemoryPresetMaxChunks("4");
        setMemoryPresetSourcePaths([]);
        toast.success("Project Memory preset saved");
      },
      onError: (error) => toast.error(error.message),
    });
  const deleteProjectMemoryPreset =
    trpc.settings.deleteProjectMemoryPreset.useMutation({
      onSuccess: (data) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        toast.success("Project Memory preset deleted");
      },
      onError: (error) => toast.error(error.message),
    });
  const createCheckpoint = trpc.settings.createCheckpoint.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Checkpoint captured");
    },
    onError: (error) => toast.error(error.message),
  });
  const previewCheckpoint = trpc.settings.previewCheckpoint.useMutation({
    onSuccess: (data) => {
      setCheckpointPreview(data);
      setRestoreConfirmation("");
      setSelectedCheckpointFiles(
        getLocalAdeCheckpointRestorePlan(data).restorableSafeFiles
      );
      setSelectedCheckpointHunks([]);
    },
    onError: (error) => toast.error(error.message),
  });
  const restoreCheckpoint = trpc.settings.restoreCheckpoint.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setCheckpointPreview(null);
      setRestoreConfirmation("");
      setSelectedCheckpointHunks([]);
      toast.success("Checkpoint restored");
    },
    onError: (error) => toast.error(error.message),
  });
  const shelveCheckpointConflicts =
    trpc.settings.shelveCheckpointConflicts.useMutation({
      onSuccess: (data, variables) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        setRestoreConfirmation("");
        setSelectedCheckpointFiles([]);
        setSelectedCheckpointHunks([]);
        toast.success("Checkpoint blockers shelved");
        previewCheckpoint.mutate({
          checkpointId: variables.checkpointId,
        });
      },
      onError: (error) => toast.error(error.message),
    });
  const resolveCheckpointTrackedConflictChoice =
    trpc.settings.resolveCheckpointTrackedConflictChoice.useMutation({
      onSuccess: (data, variables) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        setRestoreConfirmation("");
        setSelectedCheckpointFiles([]);
        setSelectedCheckpointHunks([]);
        toast.success(
          variables.resolution === "current"
            ? "Current checkpoint conflict content kept"
            : "Tracked checkpoint conflict restored"
        );
        previewCheckpoint.mutate({
          checkpointId: variables.checkpointId,
        });
      },
      onError: (error) => toast.error(error.message),
    });
  const resolveCheckpointTrackedConflictHunks =
    trpc.settings.resolveCheckpointTrackedConflictHunks.useMutation({
      onSuccess: (data, variables) => {
        utils.settings.getLocalAdeSnapshot.setData(undefined, data);
        setRestoreConfirmation("");
        setSelectedCheckpointFiles([]);
        setSelectedCheckpointHunks([]);
        toast.success("Tracked checkpoint conflict hunk choices applied");
        previewCheckpoint.mutate({
          checkpointId: variables.checkpointId,
        });
      },
      onError: (error) => toast.error(error.message),
    });
  const restoreCheckpointFiles = trpc.settings.restoreCheckpointFiles.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setCheckpointPreview(null);
      setRestoreConfirmation("");
      setSelectedCheckpointFiles([]);
      setSelectedCheckpointHunks([]);
      toast.success("Selected checkpoint files restored");
    },
    onError: (error) => toast.error(error.message),
  });
  const restoreCheckpointHunks = trpc.settings.restoreCheckpointHunks.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setCheckpointPreview(null);
      setRestoreConfirmation("");
      setSelectedCheckpointFiles([]);
      setSelectedCheckpointHunks([]);
      toast.success("Selected checkpoint hunks restored");
    },
    onError: (error) => toast.error(error.message),
  });
  const toggleCheckpointFileSelection = React.useCallback(
    (file: string, checked: boolean) => {
      setSelectedCheckpointFiles((current) => {
        const next = new Set(current);
        if (checked) {
          next.add(file);
        } else {
          next.delete(file);
        }
        return [...next].sort();
      });
    },
    []
  );
  const toggleCheckpointHunkSelection = React.useCallback(
    (selection: CheckpointHunkSelection, checked: boolean) => {
      setSelectedCheckpointHunks((current) => {
        const next = new Map(
          current.map((item) => [checkpointHunkSelectionKey(item), item])
        );
        if (checked) {
          next.set(checkpointHunkSelectionKey(selection), selection);
        } else {
          next.delete(checkpointHunkSelectionKey(selection));
        }
        return [...next.values()].sort(
          (left, right) =>
            left.file.localeCompare(right.file) || left.hunkIndex - right.hunkIndex
        );
      });
    },
    []
  );
  const setCheckpointFileHunks = React.useCallback(
    (file: string, hunkCount: number, checked: boolean) => {
      setSelectedCheckpointHunks((current) => {
        const next = new Map(
          current
            .filter((item) => item.file !== file)
            .map((item) => [checkpointHunkSelectionKey(item), item])
        );
        if (checked) {
          for (let hunkIndex = 0; hunkIndex < hunkCount; hunkIndex += 1) {
            const selection = { file, hunkIndex };
            next.set(checkpointHunkSelectionKey(selection), selection);
          }
        }
        return [...next.values()].sort(
          (left, right) =>
            left.file.localeCompare(right.file) || left.hunkIndex - right.hunkIndex
        );
      });
    },
    []
  );
  const toggleMemoryPresetSource = React.useCallback(
    (relativePath: string, checked: boolean) => {
      setMemoryPresetSourcePaths((current) => {
        const next = new Set(current);
        if (checked) {
          next.add(relativePath);
        } else {
          next.delete(relativePath);
        }
        return [...next].sort();
      });
    },
    []
  );

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="space-y-2">
        <div className="rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium text-sm">Project Memory Presets</div>
              <div className="truncate text-muted-foreground text-xs">
                {memorySources.length} sources available
              </div>
            </div>
            <Badge variant={memoryPresets.length > 0 ? "default" : "outline"}>
              {memoryPresets.length} presets
            </Badge>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_120px]">
            <Input
              aria-label="Project memory preset name"
              onChange={(event) => setMemoryPresetName(event.target.value)}
              placeholder="Preset name"
              value={memoryPresetName}
            />
            <Input
              aria-label="Project memory preset byte budget"
              inputMode="numeric"
              onChange={(event) => setMemoryPresetMaxBytes(event.target.value)}
              placeholder="12000"
              value={memoryPresetMaxBytes}
            />
          </div>
          <Input
            aria-label="Project memory preset default query"
            className="mt-2"
            onChange={(event) => setMemoryPresetQuery(event.target.value)}
            placeholder="Default request for this preset"
            value={memoryPresetQuery}
          />
          <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_120px]">
            <label className="flex min-w-0 items-center gap-2 rounded border bg-muted/20 px-2 py-2 text-xs">
              <Checkbox
                checked={memoryPresetRetrievalMode === "semantic"}
                onCheckedChange={(checked) =>
                  setMemoryPresetRetrievalMode(
                    checked === true ? "semantic" : "full"
                  )
                }
              />
              <span className="min-w-0 flex-1 truncate">
                Use ranked memory chunks
              </span>
            </label>
            <Input
              aria-label="Project memory preset ranked chunks"
              disabled={memoryPresetRetrievalMode !== "semantic"}
              inputMode="numeric"
              onChange={(event) => setMemoryPresetMaxChunks(event.target.value)}
              placeholder="4"
              value={memoryPresetMaxChunks}
            />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {memorySources.map((source) => (
              <label
                className="flex min-w-0 items-center gap-2 rounded border bg-muted/20 p-2 text-xs"
                key={source.id}
              >
                <Checkbox
                  checked={memoryPresetSourcePaths.includes(source.relativePath)}
                  onCheckedChange={(checked) =>
                    toggleMemoryPresetSource(source.relativePath, checked === true)
                  }
                />
                <span className="min-w-0 flex-1 truncate">
                  {source.relativePath}
                </span>
                <Badge variant={source.enabled ? "default" : "outline"}>
                  {source.enabled ? "on" : "off"}
                </Badge>
              </label>
            ))}
          </div>
          <Button
            className="mt-3"
            disabled={
              upsertProjectMemoryPreset.isPending ||
              !memoryPresetName.trim() ||
              memoryPresetSourcePaths.length === 0
            }
            onClick={() =>
              upsertProjectMemoryPreset.mutate({
                name: memoryPresetName,
                sourcePaths: memoryPresetSourcePaths,
                defaultQuery: memoryPresetQuery.trim() || undefined,
                retrievalMode: memoryPresetRetrievalMode,
                maxBytes: Number(memoryPresetMaxBytes) || undefined,
                maxChunks:
                  memoryPresetRetrievalMode === "semantic"
                    ? Number(memoryPresetMaxChunks) || undefined
                    : undefined,
              })
            }
            size="sm"
            type="button"
          >
            <Save className="mr-2 h-4 w-4" />
            Save Preset
          </Button>
          {memoryPresets.length > 0 ? (
            <div className="mt-3 divide-y rounded-md border bg-muted/20">
              {memoryPresets.map((preset) => (
                <div
                  className="grid gap-2 p-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto]"
                  key={preset.id}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-sm">
                      {preset.name}
                    </div>
                    <div className="truncate font-mono text-muted-foreground">
                      /memory --preset {preset.id}
                    </div>
                    <div className="truncate text-muted-foreground">
                      {preset.sourcePaths.join(", ")} - {formatBytes(preset.maxBytes)}
                      {preset.retrievalMode === "semantic"
                        ? ` - ${preset.maxChunks} ranked chunk${preset.maxChunks === 1 ? "" : "s"}`
                        : ""}
                    </div>
                    {preset.diagnostics.length > 0 ? (
                      <div className="mt-1 line-clamp-2 text-muted-foreground">
                        {preset.diagnostics.join(" ")}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center sm:justify-end">
                    <Button
                      disabled={deleteProjectMemoryPreset.isPending}
                      onClick={() =>
                        deleteProjectMemoryPreset.mutate({ id: preset.id })
                      }
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {memorySources.map((source) => (
          <div className="rounded-md border p-3" key={source.id}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-sm">{source.label}</div>
                <div className="truncate text-muted-foreground text-xs">
                  {source.relativePath} - {formatBytes(source.byteLength)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={source.enabled ? "default" : "outline"}>
                  {source.enabled ? "included" : "off"}
                </Badge>
                <Switch
                  checked={source.enabled}
                  disabled={updateMemory.isPending}
                  onCheckedChange={(enabled) =>
                    updateMemory.mutate({
                      capabilityId: source.id,
                      enabled,
                    })
                  }
                  size="sm"
                />
              </div>
            </div>
            <pre className="mt-2 max-h-28 overflow-hidden whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
              {source.preview || "No preview"}
            </pre>
          </div>
        ))}
        {memorySources.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
            No project memory files found in this root.
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium text-sm">Workspace Changes</div>
              <div className="text-muted-foreground text-xs">
                {snapshot?.changeTrust.isGitRepo
                  ? "Git diff fallback is active"
                  : "No Git repository detected"}
              </div>
            </div>
            <Badge variant={snapshot?.changeTrust.isGitRepo ? "default" : "outline"}>
              {snapshot?.changeTrust.changedFiles.length ?? 0} changed
            </Badge>
          </div>
          <Button
            className="mt-3"
            disabled={
              createCheckpoint.isPending || snapshot?.changeTrust.isGitRepo === false
            }
            onClick={() => createCheckpoint.mutate({})}
            size="sm"
            type="button"
            variant="outline"
          >
            <Save className="mr-2 h-4 w-4" />
            Create Checkpoint
          </Button>
          <div className="mt-2 max-h-48 overflow-y-auto rounded bg-muted/30 p-2 font-mono text-[11px]">
            {(snapshot?.changeTrust.statusLines ?? []).slice(0, 24).map((line) => (
              <div className="truncate" key={line} title={line}>
                {line}
              </div>
            ))}
            {(snapshot?.changeTrust.statusLines.length ?? 0) === 0 ? (
              <div className="text-muted-foreground">No changed files.</div>
            ) : null}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium text-sm">Checkpoints</div>
              <div className="text-muted-foreground text-xs">
                {shortPath(snapshot?.checkpoints.storagePath)}
              </div>
            </div>
            <Badge variant="outline">{snapshot?.checkpoints.items.length ?? 0}</Badge>
          </div>
          <div className="mt-2 max-h-48 overflow-y-auto space-y-2">
            {(snapshot?.checkpoints.items ?? []).slice(0, 8).map((checkpoint) => (
              <div className="rounded border p-2" key={checkpoint.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-xs">
                    {checkpoint.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant={checkpoint.canRestore ? "default" : "outline"}>
                      {formatBytes(checkpoint.patchBytes)}
                    </Badge>
                    <Button
                      disabled={previewCheckpoint.isPending}
                      onClick={() =>
                        previewCheckpoint.mutate({
                          checkpointId: checkpoint.id,
                        })
                      }
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      Preview
                    </Button>
                  </div>
                </div>
                <div className="mt-1 truncate text-muted-foreground text-[11px]">
                  {formatTime(checkpoint.createdAt)} -{" "}
                  {checkpoint.changedFiles.length} files -{" "}
                  {checkpoint.sessionIds.length} sessions
                </div>
                {(checkpoint.sessionAttributions ?? []).slice(0, 2).map((session) => (
                  <div
                    className="mt-1 grid grid-cols-[72px_1fr] gap-2 rounded bg-muted/30 px-2 py-1 text-[11px]"
                    key={session.chatId}
                  >
                    <Badge variant={statusVariant(session.status)}>
                      {session.source}
                    </Badge>
                    <div className="min-w-0">
                      <div className="truncate">
                        {session.agentName ?? shortId(session.chatId)} -{" "}
                        {session.messageCount} msgs
                        {session.activeTurnId || session.lastCompletedTurnId
                          ? ` - turn ${shortId(
                              session.activeTurnId ?? session.lastCompletedTurnId
                            )}`
                          : ""}
                      </div>
                      {session.lastMessagePreview ? (
                        <div
                          className="truncate text-muted-foreground"
                          title={session.lastMessagePreview}
                        >
                          {session.lastMessageRole ?? "message"}:{" "}
                          {session.lastMessagePreview}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {shortPath(checkpoint.patchPath)}
                </div>
                {checkpoint.preRestoreSafetyCheckpointId ? (
                  <div className="mt-1 truncate text-[11px] text-emerald-600 dark:text-emerald-300">
                    safety: {checkpoint.preRestoreSafetyCheckpointId}
                  </div>
                ) : null}
                {checkpoint.safetyForCheckpointId ? (
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    pre-restore safety for {checkpoint.safetyForCheckpointId}
                  </div>
                ) : null}
                {(checkpoint.partialRestores ?? []).slice(0, 2).map((restore) => (
                  <div
                    className="mt-1 truncate text-[11px] text-blue-600 dark:text-blue-300"
                    key={`${restore.restoredAt}:${restore.files.join(",")}`}
                    title={
                      restore.hunks?.length
                        ? restore.hunks
                            .map((hunk) => `${hunk.file}#${hunk.hunkIndex}`)
                            .join(", ")
                        : restore.files.join(", ")
                    }
                  >
                    selected restore {formatTime(restore.restoredAt)} -{" "}
                    {restore.hunks?.length
                      ? `${restore.hunks.length} hunks`
                      : `${restore.files.length} files`}
                    {restore.resolution ? ` - ${restore.resolution}` : ""}
                    {restore.safetyCheckpointId ? ` - safety ${restore.safetyCheckpointId}` : ""}
                  </div>
                ))}
                {(checkpoint.conflictShelves ?? []).slice(0, 2).map((shelf) => (
                  <div
                    className="mt-1 truncate text-[11px] text-amber-600 dark:text-amber-300"
                    key={`${shelf.shelvedAt}:${shelf.files.join(",")}`}
                    title={shelf.shelfPath}
                  >
                    shelved blockers {formatTime(shelf.shelvedAt)} -{" "}
                    {shelf.files.length} files - {shortPath(shelf.shelfPath)}
                  </div>
                ))}
              </div>
            ))}
            {(snapshot?.checkpoints.items.length ?? 0) === 0 ? (
              <div className="rounded border border-dashed p-3 text-muted-foreground text-sm">
                No checkpoints captured for this project.
              </div>
            ) : null}
          </div>
          {checkpointPreview ? (
            <div className="mt-2 rounded-md border bg-muted/20 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-xs">
                    {checkpointPreview.name}
                  </div>
                  <div className="truncate text-muted-foreground text-[11px]">
                    {checkpointPreview.changedFiles.length} files -{" "}
                    {formatBytes(checkpointPreview.patchBytes)}
                    {checkpointPreview.truncated ? " - truncated" : ""}
                  </div>
                </div>
                <Badge variant={checkpointPreview.canRestore ? "default" : "secondary"}>
                  {checkpointPreview.canRestore ? "restore ready" : "restore blocked"}
                </Badge>
              </div>
              <div className="mt-2 rounded border bg-background/60 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-xs">Safe restore plan</div>
                    <div className="mt-0.5 truncate text-muted-foreground text-[11px]">
                      {checkpointRestorePlan.safeFiles.length} safe /{" "}
                      {checkpointRestorePlan.warningFiles.length} warning /{" "}
                      {checkpointRestorePlan.blockedFiles.length} blocked
                      {checkpointRestorePlan.canRestoreAll
                        ? " - full restore available"
                        : " - use selected restore for safe files"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      disabled={!checkpointRestorePlan.canRestoreSelectedSafeFiles}
                      onClick={() => {
                        setSelectedCheckpointFiles(
                          checkpointRestorePlan.restorableSafeFiles
                        );
                        setSelectedCheckpointHunks([]);
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      Select Safe
                    </Button>
                    <Button
                      disabled={
                        selectedCheckpointFiles.length === 0 &&
                        selectedCheckpointHunks.length === 0
                      }
                      onClick={() => {
                        setSelectedCheckpointFiles([]);
                        setSelectedCheckpointHunks([]);
                      }}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      Clear
                    </Button>
                  </div>
                </div>
                {checkpointRestorePlan.restorableSafeFiles.length > 0 ? (
                  <div className="mt-1 truncate font-mono text-[11px]">
                    {checkpointRestorePlan.restorableSafeFiles.join(", ")}
                  </div>
                ) : (
                  <div className="mt-1 text-muted-foreground text-[11px]">
                    No safe patch-backed file is available for selected restore.
                  </div>
                )}
                {checkpointRestorePlan.shelvableBlockedFiles.length > 0 ? (
                  <div className="mt-1 truncate text-amber-600 text-[11px] dark:text-amber-300">
                    shelvable blockers:{" "}
                    <span className="font-mono">
                      {checkpointRestorePlan.shelvableBlockedFiles.join(", ")}
                    </span>
                  </div>
                ) : null}
                {checkpointRestorePlan.trackedConflictFiles.length > 0 ? (
                  <div className="mt-1 truncate text-blue-600 text-[11px] dark:text-blue-300">
                    tracked conflicts:{" "}
                    <span className="font-mono">
                      {checkpointRestorePlan.trackedConflictFiles.join(", ")}
                    </span>
                  </div>
                ) : null}
              </div>
              {checkpointConflictEditor.rows.length > 0 ? (
                <div className="mt-2 overflow-hidden rounded border bg-background/70">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
                    <div className="font-medium text-xs">Mixed Restore</div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline">
                        {checkpointConflictEditor.selectedFileCount} files
                      </Badge>
                      <Badge variant="outline">
                        {checkpointConflictEditor.selectedHunkCount} hunks
                      </Badge>
                      <Badge
                        variant={
                          checkpointConflictEditor.trackedConflictCount > 0
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {checkpointConflictEditor.trackedConflictCount} tracked
                      </Badge>
                      <Badge
                        variant={
                          checkpointConflictEditor.shelvableBlockerCount > 0
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {checkpointConflictEditor.shelvableBlockerCount} shelves
                      </Badge>
                    </div>
                  </div>
                  <div className="max-h-72 divide-y overflow-y-auto">
                    {checkpointConflictEditor.rows.map((row) => {
                      const canRestoreFile =
                        row.availableActions.includes("restore-file");
                      const canRestoreHunks =
                        row.availableActions.includes("restore-hunks");
                      const canResolveHunkChoices = row.availableActions.includes(
                        "resolve-hunk-choices"
                      );
                      const canToggleHunks = canRestoreHunks || canResolveHunkChoices;
                      const allHunksSelected =
                        row.hunkCount > 0 && row.selectedHunks === row.hunkCount;
                      const canApplyRowHunkChoices =
                        canResolveHunkChoices &&
                        row.selectedHunks > 0 &&
                        row.selectedHunks < row.hunkCount;
                      const selectedRowConflictHunks =
                        selectedTrackedConflictHunks.filter(
                          (hunk) => hunk.file === row.file
                        );
                      return (
                        <div
                          className="grid gap-2 px-2 py-2 lg:grid-cols-[minmax(0,1fr)_auto]"
                          key={row.file}
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge variant={statusVariant(row.risk)}>
                                {row.risk}
                              </Badge>
                              <Badge variant="outline">{row.recommendedAction}</Badge>
                              {row.hasPatch ? (
                                <Badge variant="outline">{row.hunkCount} hunks</Badge>
                              ) : null}
                              <span
                                className="truncate font-mono text-[11px]"
                                title={row.file}
                              >
                                {row.file}
                              </span>
                            </div>
                            <div
                              className="mt-1 truncate text-muted-foreground text-[11px]"
                              title={row.reason}
                            >
                              {row.patchAction}
                              {row.currentStatus ? ` - current ${row.currentStatus}` : ""}
                              {row.reason ? ` - ${row.reason}` : ""}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                            {canRestoreFile ? (
                              <label className="flex items-center gap-1.5 text-[11px]">
                                <Checkbox
                                  aria-label={`Restore file ${row.file}`}
                                  checked={row.selectedFile}
                                  onCheckedChange={(checked) =>
                                    toggleCheckpointFileSelection(
                                      row.file,
                                      checked === true
                                    )
                                  }
                                />
                                File
                              </label>
                            ) : null}
                            {canToggleHunks ? (
                              <Button
                                onClick={() =>
                                  setCheckpointFileHunks(
                                    row.file,
                                    row.hunkCount,
                                    !allHunksSelected
                                  )
                                }
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                {allHunksSelected ? "Clear Hunks" : "All Hunks"}
                              </Button>
                            ) : null}
                            {canResolveHunkChoices ? (
                              <Button
                                disabled={
                                  resolveCheckpointTrackedConflictChoice.isPending ||
                                  resolveCheckpointTrackedConflictHunks.isPending ||
                                  !checkpointRestoreConfirmed ||
                                  !canApplyRowHunkChoices
                                }
                                onClick={() =>
                                  resolveCheckpointTrackedConflictHunks.mutate({
                                    checkpointId: checkpointPreview.checkpointId,
                                    confirmation: restoreConfirmation,
                                    hunks: selectedRowConflictHunks,
                                  })
                                }
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                <GitBranch className="mr-1.5 h-3.5 w-3.5" />
                                Apply Hunks
                              </Button>
                            ) : null}
                            {row.availableActions.includes("shelve-blocker") ? (
                              <Button
                                disabled={
                                  shelveCheckpointConflicts.isPending ||
                                  !checkpointRestoreConfirmed
                                }
                                onClick={() =>
                                  shelveCheckpointConflicts.mutate({
                                    checkpointId: checkpointPreview.checkpointId,
                                    confirmation: restoreConfirmation,
                                    files: [row.file],
                                  })
                                }
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                <Archive className="mr-1.5 h-3.5 w-3.5" />
                                Shelve
                              </Button>
                            ) : null}
                            {row.availableActions.includes("keep-current") ? (
                              <Button
                                disabled={
                                  resolveCheckpointTrackedConflictChoice.isPending ||
                                  resolveCheckpointTrackedConflictHunks.isPending ||
                                  !checkpointRestoreConfirmed
                                }
                                onClick={() =>
                                  resolveCheckpointTrackedConflictChoice.mutate({
                                    checkpointId: checkpointPreview.checkpointId,
                                    confirmation: restoreConfirmation,
                                    files: [row.file],
                                    resolution: "current",
                                  })
                                }
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                <XCircle className="mr-1.5 h-3.5 w-3.5" />
                                Keep
                              </Button>
                            ) : null}
                            {row.availableActions.includes("use-restore-side") ? (
                              <Button
                                disabled={
                                  resolveCheckpointTrackedConflictChoice.isPending ||
                                  resolveCheckpointTrackedConflictHunks.isPending ||
                                  !checkpointRestoreConfirmed
                                }
                                onClick={() =>
                                  resolveCheckpointTrackedConflictChoice.mutate({
                                    checkpointId: checkpointPreview.checkpointId,
                                    confirmation: restoreConfirmation,
                                    files: [row.file],
                                    resolution: "restore",
                                  })
                                }
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                <GitBranch className="mr-1.5 h-3.5 w-3.5" />
                                Restore Side
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {checkpointVisualMerge.files.length > 0 ? (
                <div className="mt-2 overflow-hidden rounded border bg-background/70">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="font-medium text-xs">Visual Merge</div>
                      <div className="truncate text-muted-foreground text-[11px]">
                        {checkpointVisualMerge.currentLabel} vs{" "}
                        {checkpointVisualMerge.restoreLabel}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline">{checkpointVisualMerge.mode}</Badge>
                      <Badge variant="outline">
                        {checkpointVisualMerge.totalFiles} files
                      </Badge>
                      <Badge variant="outline">
                        {checkpointVisualMerge.totalHunks} hunks
                      </Badge>
                      <Badge variant="outline">
                        {checkpointVisualMerge.selectedHunks} selected
                      </Badge>
                    </div>
                  </div>
                  <div className="max-h-[32rem] divide-y overflow-y-auto">
                    {checkpointVisualMerge.files.map((file) => {
                      const canSelectFile =
                        checkpointRiskByFile.get(file.path)?.level === "safe";
                      const canSelectHunks = file.hunks.some((hunk) => hunk.selectable);
                      const allHunksSelected =
                        file.hunkCount > 0 && file.selectedHunks === file.hunkCount;
                      return (
                        <div className="p-2" key={file.path}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1">
                                <Badge variant={statusVariant(file.risk)}>
                                  {file.risk}
                                </Badge>
                                <Badge variant={statusVariant(file.status)}>
                                  {file.status}
                                </Badge>
                                <Badge variant="outline">
                                  {file.recommendedAction}
                                </Badge>
                                <span
                                  className="truncate font-mono text-[11px]"
                                  title={file.path}
                                >
                                  {file.path}
                                </span>
                              </div>
                              <div className="mt-1 text-muted-foreground text-[11px]">
                                current {file.currentChangeRows} / restore{" "}
                                {file.restoreChangeRows} / +{file.additions} / -
                                {file.deletions}
                                {file.truncated ? " / truncated" : ""}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {canSelectFile ? (
                                <label className="flex items-center gap-1.5 text-[11px]">
                                  <Checkbox
                                    aria-label={`Restore file ${file.path} from visual merge`}
                                    checked={file.selectedFile}
                                    onCheckedChange={(checked) =>
                                      toggleCheckpointFileSelection(
                                        file.path,
                                        checked === true
                                      )
                                    }
                                  />
                                  File
                                </label>
                              ) : null}
                              {canSelectHunks ? (
                                <Button
                                  onClick={() =>
                                    setCheckpointFileHunks(
                                      file.path,
                                      file.hunkCount,
                                      !allHunksSelected
                                    )
                                  }
                                  size="sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  {allHunksSelected ? "Clear Hunks" : "All Hunks"}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-2 overflow-hidden rounded border">
                            <div className="grid min-w-[760px] grid-cols-[48px_minmax(0,1fr)_48px_minmax(0,1fr)] border-b bg-muted/40 px-0 text-[11px]">
                              <div className="border-r px-1.5 py-1 text-right text-muted-foreground">
                                #
                              </div>
                              <div className="border-r px-1.5 py-1 font-medium">
                                {checkpointVisualMerge.currentLabel}
                              </div>
                              <div className="border-r px-1.5 py-1 text-right text-muted-foreground">
                                #
                              </div>
                              <div className="px-1.5 py-1 font-medium">
                                {checkpointVisualMerge.restoreLabel}
                              </div>
                            </div>
                            <div className="max-h-72 overflow-auto">
                              {file.hunks.map((hunk) => {
                                const selection = {
                                  file: hunk.file,
                                  hunkIndex: hunk.hunkIndex,
                                };
                                return (
                                  <div
                                    className="min-w-[760px] border-b last:border-b-0"
                                    key={`${hunk.file}:${hunk.hunkIndex}`}
                                  >
                                    <div className="flex items-center gap-2 border-b bg-background px-2 py-1 text-[11px] text-muted-foreground">
                                      <Checkbox
                                        aria-label={`Select visual merge hunk ${hunk.hunkIndex + 1} in ${hunk.file}`}
                                        checked={hunk.selected}
                                        disabled={!hunk.selectable}
                                        onCheckedChange={(checked) =>
                                          toggleCheckpointHunkSelection(
                                            selection,
                                            checked === true
                                          )
                                        }
                                      />
                                      <span className="font-mono">
                                        Hunk {hunk.hunkIndex + 1}
                                      </span>
                                      <span
                                        className="min-w-0 truncate font-mono"
                                        title={hunk.header}
                                      >
                                        {hunk.header}
                                        {hunk.truncated ? " truncated" : ""}
                                      </span>
                                    </div>
                                    {hunk.rows.map((row) => (
                                      <div
                                        className="grid grid-cols-[48px_minmax(0,1fr)_48px_minmax(0,1fr)] border-b text-[11px] last:border-b-0"
                                        key={`${hunk.file}:${hunk.hunkIndex}:${row.rowIndex}`}
                                      >
                                        <div className="select-none border-r px-1.5 py-0.5 text-right text-muted-foreground">
                                          {row.current.line ?? ""}
                                        </div>
                                        <pre
                                          className={cn(
                                            "overflow-hidden whitespace-pre-wrap break-all border-r px-1.5 py-0.5 font-mono",
                                            checkpointMergeCellClass(row.current.tone)
                                          )}
                                        >
                                          {row.current.text}
                                        </pre>
                                        <div className="select-none border-r px-1.5 py-0.5 text-right text-muted-foreground">
                                          {row.restore.line ?? ""}
                                        </div>
                                        <pre
                                          className={cn(
                                            "overflow-hidden whitespace-pre-wrap break-all px-1.5 py-0.5 font-mono",
                                            checkpointMergeCellClass(row.restore.tone)
                                          )}
                                        >
                                          {row.restore.text}
                                        </pre>
                                      </div>
                                    ))}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {checkpointPreview.diffFiles.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {checkpointPreview.diffFiles.map((file) => (
                    <div className="overflow-hidden rounded border" key={file.path}>
                      <div className="flex items-center justify-between gap-2 border-b bg-background px-2 py-1.5">
                        <div className="flex min-w-0 items-start gap-2">
                          <Checkbox
                            aria-label={`Select ${file.path} for restore`}
                            checked={selectedCheckpointFileSet.has(file.path)}
                            className="mt-0.5"
                            disabled={checkpointRiskByFile.get(file.path)?.level !== "safe"}
                            onCheckedChange={(checked) =>
                              toggleCheckpointFileSelection(file.path, checked === true)
                            }
                          />
                          <div className="min-w-0">
                          <div className="truncate font-mono text-[11px]" title={file.path}>
                            {file.path}
                          </div>
                          <div className="truncate text-muted-foreground text-[11px]">
                            +{file.additions} / -{file.deletions}
                            {file.oldPath && file.newPath && file.oldPath !== file.newPath
                              ? ` - ${file.oldPath} -> ${file.newPath}`
                              : ""}
                            {file.truncated ? " - truncated" : ""}
                          </div>
                        </div>
                        </div>
                        <Badge variant={statusVariant(file.status)}>{file.status}</Badge>
                      </div>
                      <div className="max-h-72 overflow-auto">
                        {file.hunks.map((hunk, hunkIndex) => {
                          const hunkSelection = { file: file.path, hunkIndex };
                          const hunkSelectionKey =
                            checkpointHunkSelectionKey(hunkSelection);
                          return (
                          <div key={`${file.path}:${hunk.header}:${hunkIndex}`}>
                            <div className="flex items-center gap-2 border-b bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
                              <Checkbox
                                aria-label={`Select hunk ${hunkIndex + 1} in ${file.path}`}
                                checked={selectedCheckpointHunkSet.has(hunkSelectionKey)}
                                disabled={!isCheckpointHunkSelectable(file.path)}
                                onCheckedChange={(checked) =>
                                  toggleCheckpointHunkSelection(
                                    hunkSelection,
                                    checked === true
                                  )
                                }
                              />
                              <div className="min-w-0 truncate font-mono" title={hunk.header}>
                                {hunk.header}
                                {hunk.truncated ? " truncated" : ""}
                              </div>
                            </div>
                            <div className="min-w-[720px]">
                              {hunk.rows.map((row, rowIndex) => (
                                <div
                                  className={cn(
                                    "grid grid-cols-[46px_minmax(0,1fr)_46px_minmax(0,1fr)] border-b text-[11px] last:border-b-0",
                                    diffRowClass(row.kind)
                                  )}
                                  key={`${file.path}:${hunkIndex}:${rowIndex}`}
                                >
                                  <div className="select-none border-r px-1.5 py-0.5 text-right text-muted-foreground">
                                    {row.oldLine ?? ""}
                                  </div>
                                  <pre
                                    className={cn(
                                      "overflow-hidden whitespace-pre-wrap break-all border-r px-1.5 py-0.5 font-mono",
                                      diffCellClass(row.kind, "old")
                                    )}
                                  >
                                    {row.oldText ?? ""}
                                  </pre>
                                  <div className="select-none border-r px-1.5 py-0.5 text-right text-muted-foreground">
                                    {row.newLine ?? ""}
                                  </div>
                                  <pre
                                    className={cn(
                                      "overflow-hidden whitespace-pre-wrap break-all px-1.5 py-0.5 font-mono",
                                      diffCellClass(row.kind, "new")
                                    )}
                                  >
                                    {row.newText ?? ""}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          </div>
                          );
                        })}
                        {file.hunks.length === 0 ? (
                          <div className="p-2 text-muted-foreground text-[11px]">
                            Binary or metadata-only patch.
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[11px] text-muted-foreground">
                {checkpointPreview.preview || "Patch is empty."}
              </pre>
              {(checkpointPreview.sessionAttributions ?? []).length > 0 ? (
                <div className="mt-2 overflow-hidden rounded border">
                  <div className="grid grid-cols-[88px_1fr_92px] gap-2 border-b bg-background px-2 py-1.5 font-medium text-[11px]">
                    <span>Session</span>
                    <span>Attribution</span>
                    <span>Messages</span>
                  </div>
                  <div className="max-h-32 overflow-y-auto">
                    {(checkpointPreview.sessionAttributions ?? []).map((session) => (
                      <div
                        className="grid grid-cols-[88px_1fr_92px] gap-2 border-b px-2 py-1.5 text-[11px] last:border-b-0"
                        key={session.chatId}
                      >
                        <Badge variant={statusVariant(session.status)}>
                          {session.source}
                        </Badge>
                        <div className="min-w-0">
                          <div className="truncate">
                            {session.agentName ?? "Agent"} - chat{" "}
                            {shortId(session.chatId)}
                            {session.sessionId
                              ? ` / agent ${shortId(session.sessionId)}`
                              : ""}
                          </div>
                          {session.activeTurnId || session.lastCompletedTurnId ? (
                            <div className="truncate text-muted-foreground">
                              turn{" "}
                              {shortId(
                                session.activeTurnId ?? session.lastCompletedTurnId
                              )}
                              {session.lastCompletedTurnId ? " completed" : " active"}
                            </div>
                          ) : null}
                          {session.lastMessagePreview ? (
                            <div
                              className="truncate text-muted-foreground"
                              title={session.lastMessagePreview}
                            >
                              {session.lastMessageRole ?? "message"}:{" "}
                              {session.lastMessagePreview}
                            </div>
                          ) : null}
                        </div>
                        <div className="text-muted-foreground">
                          <div>{session.messageCount}</div>
                          {session.lastMessageAt ? (
                            <div>{formatTime(session.lastMessageAt)}</div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {checkpointPreview.restoreRisks.length > 0 ? (
                <div className="mt-2 overflow-hidden rounded border">
                  <div className="grid grid-cols-[86px_1fr_150px] gap-2 border-b bg-background px-2 py-1.5 font-medium text-[11px]">
                    <span>Risk</span>
                    <span>File</span>
                    <span>Patch Action</span>
                  </div>
                  <div className="max-h-36 overflow-y-auto">
                    {checkpointPreview.restoreRisks.map((risk) => (
                      <div
                        className="grid grid-cols-[86px_1fr_150px] gap-2 border-b px-2 py-1.5 text-[11px] last:border-b-0"
                        key={`${risk.file}:${risk.patchAction}`}
                      >
                        <Badge variant={statusVariant(risk.level)}>
                          {risk.level}
                        </Badge>
                        <div className="min-w-0">
                          <div className="truncate font-mono" title={risk.file}>
                            {risk.file}
                          </div>
                          <div
                            className="truncate text-muted-foreground"
                            title={risk.reason}
                          >
                            {risk.reason}
                          </div>
                          {risk.checkpointStatus || risk.currentStatus ? (
                            <div className="truncate text-muted-foreground">
                              checkpoint {risk.checkpointStatus ?? "clean"} / current{" "}
                              {risk.currentStatus ?? "clean"}
                            </div>
                          ) : null}
                        </div>
                        <span className="truncate text-muted-foreground">
                          {risk.patchAction}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {checkpointPreview.restoreBlockers.length > 0 ? (
                <div className="mt-2 space-y-1 text-muted-foreground text-[11px]">
                  {checkpointPreview.restoreBlockers.map((blocker) => (
                    <div key={`${blocker.file}:${blocker.reason}`}>
                      {blocker.file}: {blocker.reason}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 grid gap-2">
                <Input
                  aria-label="Checkpoint restore confirmation"
                  onChange={(event) => setRestoreConfirmation(event.target.value)}
                  placeholder={`Type ${checkpointPreview.restoreToken}`}
                  value={restoreConfirmation}
                />
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Badge variant="outline">
                    {selectedCheckpointFiles.length} files
                  </Badge>
                  <Badge variant="outline">
                    {selectedCheckpointHunks.length} hunks
                  </Badge>
                  <Badge variant="outline">
                    {selectedSafeCheckpointHunks.length} safe hunks
                  </Badge>
                  <Badge variant="outline">
                    {selectedTrackedConflictHunks.length} conflict hunks
                  </Badge>
                  <Button
                    disabled={
                      shelveCheckpointConflicts.isPending ||
                      !checkpointRestorePlan.canShelveBlockedFiles ||
                      restoreConfirmation.trim() !== checkpointPreview.restoreToken
                    }
                    onClick={() =>
                      shelveCheckpointConflicts.mutate({
                        checkpointId: checkpointPreview.checkpointId,
                        confirmation: restoreConfirmation,
                        files: checkpointRestorePlan.shelvableBlockedFiles,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Archive className="mr-1.5 h-3.5 w-3.5" />
                    Shelve Blockers
                  </Button>
                  <Button
                    disabled={
                      resolveCheckpointTrackedConflictChoice.isPending ||
                      resolveCheckpointTrackedConflictHunks.isPending ||
                      !checkpointRestorePlan.canResolveTrackedConflicts ||
                      restoreConfirmation.trim() !== checkpointPreview.restoreToken
                    }
                    onClick={() =>
                      resolveCheckpointTrackedConflictChoice.mutate({
                        checkpointId: checkpointPreview.checkpointId,
                        confirmation: restoreConfirmation,
                        files: checkpointRestorePlan.trackedConflictFiles,
                        resolution: "current",
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <XCircle className="mr-1.5 h-3.5 w-3.5" />
                    Keep Current
                  </Button>
                  <Button
                    disabled={
                      resolveCheckpointTrackedConflictChoice.isPending ||
                      resolveCheckpointTrackedConflictHunks.isPending ||
                      !checkpointRestorePlan.canResolveTrackedConflicts ||
                      restoreConfirmation.trim() !== checkpointPreview.restoreToken
                    }
                    onClick={() =>
                      resolveCheckpointTrackedConflictChoice.mutate({
                        checkpointId: checkpointPreview.checkpointId,
                        confirmation: restoreConfirmation,
                        files: checkpointRestorePlan.trackedConflictFiles,
                        resolution: "restore",
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <GitBranch className="mr-1.5 h-3.5 w-3.5" />
                    Use Restore Side
                  </Button>
                  <Button
                    disabled={
                      resolveCheckpointTrackedConflictChoice.isPending ||
                      resolveCheckpointTrackedConflictHunks.isPending ||
                      !canApplySelectedTrackedConflictHunks ||
                      restoreConfirmation.trim() !== checkpointPreview.restoreToken
                    }
                    onClick={() =>
                      resolveCheckpointTrackedConflictHunks.mutate({
                        checkpointId: checkpointPreview.checkpointId,
                        confirmation: restoreConfirmation,
                        hunks: selectedTrackedConflictHunks,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <GitBranch className="mr-1.5 h-3.5 w-3.5" />
                    Apply Conflict Hunks
                  </Button>
                  <Button
                    disabled={
                      restoreCheckpointHunks.isPending ||
                      selectedSafeCheckpointHunks.length === 0 ||
                      restoreConfirmation.trim() !== checkpointPreview.restoreToken
                    }
                    onClick={() =>
                      restoreCheckpointHunks.mutate({
                        checkpointId: checkpointPreview.checkpointId,
                        confirmation: restoreConfirmation,
                        hunks: selectedSafeCheckpointHunks,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                    Restore Hunks
                  </Button>
                  <Button
                    disabled={
                      restoreCheckpointFiles.isPending ||
                      selectedCheckpointFiles.length === 0 ||
                      restoreConfirmation.trim() !== checkpointPreview.restoreToken
                    }
                    onClick={() =>
                      restoreCheckpointFiles.mutate({
                        checkpointId: checkpointPreview.checkpointId,
                        confirmation: restoreConfirmation,
                        files: selectedCheckpointFiles,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                    Restore Selected
                  </Button>
                  <Button
                    disabled={
                      restoreCheckpoint.isPending ||
                      checkpointPreview.restoreBlockers.length > 0 ||
                      restoreConfirmation.trim() !== checkpointPreview.restoreToken
                    }
                    onClick={() =>
                      restoreCheckpoint.mutate({
                        checkpointId: checkpointPreview.checkpointId,
                        confirmation: restoreConfirmation,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="destructive"
                  >
                    <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                    Restore All
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        {(snapshot?.projectMemory.warnings ?? []).slice(0, 3).map((warning) => (
          <div
            className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-amber-600 text-xs dark:text-amber-300"
            key={warning}
          >
            {warning}
          </div>
        ))}
      </div>
    </div>
  );
}

function AcpActivityPanel({ snapshot }: { snapshot: LocalAdeSnapshot | undefined }) {
  const utils = trpc.useUtils();
  const activity = snapshot?.acpActivity;
  const exportAcpActivity = trpc.settings.exportAcpActivity.useMutation();
  const replayAcpActivity = trpc.settings.replayAcpActivity.useMutation();
  const retryAcpActivityStream = trpc.settings.retryAcpActivityStream.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
    },
  });
  const saveAcpReplayPreset = trpc.settings.saveAcpReplayPreset.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
    },
  });
  const deleteAcpReplayPreset = trpc.settings.deleteAcpReplayPreset.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
    },
  });
  const [replay, setReplay] = React.useState<AcpActivityReplay | null>(null);
  const [replayIndex, setReplayIndex] = React.useState(0);
  const [isReplayPlaying, setIsReplayPlaying] = React.useState(false);
  const [presetName, setPresetName] = React.useState("");
  const kindSummary = Object.entries(activity?.stats.kinds ?? {})
    .slice(0, 4)
    .map(([kind, count]) => `${kind} ${count}`)
    .join(", ");
  const visibleReplayKinds = Object.entries(activity?.stats.kinds ?? {})
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5);
  const timeline = activity?.timeline;
  const timelineLanes = timeline?.lanes ?? [];
  const timelineFrames = timeline?.frames ?? [];
  const timelineTransitions = timeline?.transitions ?? [];
  const visibleTimelineFrames = timelineFrames.slice(-8);
  const replayPresets = activity?.replayPresets ?? [];
  const stream = activity?.stream;
  const visibleStreamGaps = stream?.gaps.slice(0, 3) ?? [];
  const visibleStreamChains = stream?.chains.slice(0, 4) ?? [];
  const primaryChatId = activity?.entries.find((entry) => entry.chatId)?.chatId;
  const replayFrames = replay?.frames ?? [];
  const currentReplayFrame = replayFrames[replayIndex];
  const currentReplayMetadata = currentReplayFrame
    ? Object.entries(currentReplayFrame.metadata)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")
    : "";
  const replayFilterText = replay
    ? [
        replay.filters.chatId ? `chat ${shortId(replay.filters.chatId)}` : null,
        replay.filters.correlationKey
          ? `correlation ${shortId(replay.filters.correlationKey)}`
          : null,
        replay.filters.kind ? `kind ${replay.filters.kind}` : null,
      ]
        .filter(Boolean)
        .join(" / ")
    : "";
  const handleCopyTrace = React.useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("Clipboard unavailable");
      return;
    }
    try {
      const trace = await exportAcpActivity.mutateAsync({
        ...(primaryChatId ? { chatId: primaryChatId } : {}),
        limit: 200,
      });
      await navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
      toast.success("ACP trace copied");
    } catch (error) {
      console.error("ACP trace export failed", error);
      toast.error(error instanceof Error ? error.message : "ACP trace export failed");
    }
  }, [exportAcpActivity, primaryChatId]);
  const handleRetryStream = React.useCallback(async () => {
    try {
      await retryAcpActivityStream.mutateAsync({});
      toast.success("ACP stream diagnostics refreshed");
    } catch (error) {
      console.error("ACP stream retry failed", error);
      toast.error(
        error instanceof Error ? error.message : "ACP stream retry failed"
      );
    }
  }, [retryAcpActivityStream]);
  const handleReplayTrace = React.useCallback(
    async (
      params: {
        chatId?: string;
        correlationKey?: string;
        kind?: string;
        limit?: number;
        workspace?: boolean;
      } = {}
    ) => {
      try {
        const requestedChatId = params.workspace
          ? undefined
          : (params.chatId ?? primaryChatId);
        const nextReplay = await replayAcpActivity.mutateAsync({
          ...(requestedChatId ? { chatId: requestedChatId } : {}),
          ...(params.correlationKey ? { correlationKey: params.correlationKey } : {}),
          ...(params.kind ? { kind: params.kind } : {}),
          limit: params.limit ?? 120,
        });
        setReplay(nextReplay);
        setReplayIndex(0);
        setIsReplayPlaying(false);
        if (nextReplay.frames.length === 0) {
          toast.info("No ACP frames to replay");
        } else {
          toast.success(`ACP replay loaded (${nextReplay.frames.length})`);
        }
      } catch (error) {
        console.error("ACP replay failed", error);
        toast.error(error instanceof Error ? error.message : "ACP replay failed");
      }
    },
    [primaryChatId, replayAcpActivity]
  );
  const handleSaveReplayPreset = React.useCallback(async () => {
    try {
      const filters = replay?.filters ?? {
        ...(primaryChatId ? { chatId: primaryChatId } : {}),
        limit: 120,
      };
      await saveAcpReplayPreset.mutateAsync({
        name: presetName,
        ...(filters.chatId ? { chatId: filters.chatId } : {}),
        ...(filters.correlationKey ? { correlationKey: filters.correlationKey } : {}),
        ...(filters.kind ? { kind: filters.kind } : {}),
        limit: filters.limit,
      });
      setPresetName("");
      toast.success("ACP replay preset saved");
    } catch (error) {
      console.error("ACP replay preset save failed", error);
      toast.error(
        error instanceof Error ? error.message : "ACP replay preset save failed"
      );
    }
  }, [presetName, primaryChatId, replay?.filters, saveAcpReplayPreset]);
  const handleDeleteReplayPreset = React.useCallback(
    async (id: string) => {
      try {
        await deleteAcpReplayPreset.mutateAsync({ id });
        toast.success("ACP replay preset deleted");
      } catch (error) {
        console.error("ACP replay preset delete failed", error);
        toast.error(
          error instanceof Error
            ? error.message
            : "ACP replay preset delete failed"
        );
      }
    },
    [deleteAcpReplayPreset]
  );

  React.useEffect(() => {
    if (!isReplayPlaying || replayFrames.length <= 1) {
      return;
    }
    const timer = window.setInterval(() => {
      setReplayIndex((current) => {
        if (current >= replayFrames.length - 1) {
          setIsReplayPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [isReplayPlaying, replayFrames.length]);

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="font-medium text-xs uppercase">ACP Activity</span>
        <div className="flex items-center gap-1.5">
          <Button
            disabled={!activity || retryAcpActivityStream.isPending}
            onClick={() => {
              void handleRetryStream();
            }}
            size="xs"
            type="button"
            variant="outline"
          >
            <RefreshCw
              className={cn(
                "mr-1 h-3 w-3",
                retryAcpActivityStream.isPending && "animate-spin"
              )}
            />
            Retry Stream
          </Button>
          <Button
            disabled={(activity?.entries.length ?? 0) === 0 || replayAcpActivity.isPending}
            onClick={() => {
              void handleReplayTrace({ workspace: true });
            }}
            size="xs"
            type="button"
            variant="outline"
          >
            <Play className="mr-1 h-3 w-3" />
            Workspace
          </Button>
          <Button
            disabled={(activity?.entries.length ?? 0) === 0 || replayAcpActivity.isPending}
            onClick={() => {
              void handleReplayTrace();
            }}
            size="xs"
            type="button"
            variant="outline"
          >
            <Play className="mr-1 h-3 w-3" />
            Replay
          </Button>
          <Button
            disabled={(activity?.entries.length ?? 0) === 0 || exportAcpActivity.isPending}
            onClick={() => {
              void handleCopyTrace();
            }}
            size="xs"
            type="button"
            variant="outline"
          >
            <Copy className="mr-1 h-3 w-3" />
            Copy Trace
          </Button>
          <Badge variant={activity?.entries.length ? "default" : "outline"}>
            {activity?.entries.length ?? 0}
          </Badge>
        </div>
      </div>
      <div className="border-b bg-muted/20 px-3 py-2 text-muted-foreground text-xs">
        {activity
          ? `${activity.stats.total} visible / ${activity.stats.chatCount} chats${
              kindSummary ? ` / ${kindSummary}` : ""
            }`
          : "Waiting for ACP activity"}
      </div>
      {stream ? (
        <div className="border-b p-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="font-medium text-muted-foreground text-[11px] uppercase">
              Stream diagnostics
            </div>
            <div className="flex items-center gap-1">
              <Badge variant={statusVariant(stream.status)}>{stream.status}</Badge>
              <Badge variant={stream.retryEligible ? "secondary" : "outline"}>
                retry {stream.retryDelayMs}ms x{stream.retryMaxAttempts}
              </Badge>
            </div>
          </div>
          <div className="grid gap-1.5 md:grid-cols-4">
            <div className="rounded border px-2 py-1.5 text-xs">
              <div className="text-muted-foreground text-[11px]">Latest</div>
              <div className="font-medium">
                {stream.latestTimestamp ? formatTime(stream.latestTimestamp) : "n/a"}
              </div>
              <div className="text-muted-foreground text-[11px]">
                age {stream.latestAgeMs}ms / stale {stream.staleAfterMs}ms
              </div>
            </div>
            <div className="rounded border px-2 py-1.5 text-xs">
              <div className="text-muted-foreground text-[11px]">Silence</div>
              <div className="font-medium">{stream.maxSilenceMs}ms max</div>
              <div className="text-muted-foreground text-[11px]">
                avg {stream.averageDeltaMs}ms / gap {stream.gapThresholdMs}ms
              </div>
            </div>
            <div className="rounded border px-2 py-1.5 text-xs">
              <div className="text-muted-foreground text-[11px]">Causality</div>
              <div className="font-medium">
                {stream.rootCount} roots / {stream.longestChainLength} longest
              </div>
              <div className="text-muted-foreground text-[11px]">
                {stream.correlatedFrameCount} correlated / {stream.orphanFrameCount} orphan
              </div>
            </div>
            <div className="rounded border px-2 py-1.5 text-xs">
              <div className="text-muted-foreground text-[11px]">Heartbeat</div>
              <div className="font-medium">{stream.heartbeatWindowMs}ms</div>
              <div className="text-muted-foreground text-[11px]">
                {stream.gaps.length} stream gap(s)
              </div>
            </div>
          </div>
          {visibleStreamGaps.length > 0 ? (
            <div className="mt-2 grid gap-1">
              {visibleStreamGaps.map((gap) => (
                <div
                  className="grid grid-cols-[64px_1fr] gap-2 rounded px-2 py-1 text-xs hover:bg-muted/30"
                  key={`${gap.fromFrameId}-${gap.toFrameId}`}
                >
                  <span className="text-muted-foreground">+{gap.deltaMs}ms</span>
                  <span className="min-w-0 truncate">
                    {gap.fromKind ?? shortId(gap.fromFrameId)}
                    {" -> "}
                    {gap.toKind ?? shortId(gap.toFrameId)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {visibleStreamChains.length > 0 ? (
            <div className="mt-2 grid gap-1 md:grid-cols-2">
              {visibleStreamChains.map((chain) => {
                const detailId =
                  chain.turnId ?? chain.sessionId ?? chain.chatId ?? chain.key;
                const warningCount = chain.levels.warn + chain.levels.error;
                return (
                  <div
                    className="grid grid-cols-[1fr_auto] items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/30"
                    key={chain.key}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono">
                        {chain.label} {shortId(detailId)}
                      </span>
                      <span
                        className="block truncate text-[11px] text-muted-foreground"
                        title={chain.latestMessage}
                      >
                        {chain.durationMs}ms / {chain.latestMessage}
                      </span>
                    </span>
                    <span className="flex items-center justify-end gap-1">
                      <Badge variant={warningCount > 0 ? "secondary" : "outline"}>
                        {chain.eventCount}
                      </Badge>
                      <Button
                        disabled={replayAcpActivity.isPending}
                        onClick={() => {
                          void handleReplayTrace({
                            ...(chain.chatId ? { chatId: chain.chatId } : {}),
                            correlationKey: chain.key,
                          });
                        }}
                        size="xs"
                        title="Replay this causal chain"
                        type="button"
                        variant="ghost"
                      >
                        <Play className="h-3 w-3" />
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
          {stream.diagnostics.length > 0 ? (
            <div className="mt-2 text-muted-foreground text-[11px]">
              {stream.diagnostics.join(" ")}
            </div>
          ) : null}
        </div>
      ) : null}
      {timelineLanes.length > 0 ? (
        <div className="border-b p-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="font-medium text-muted-foreground text-[11px] uppercase">
              Cross-session timeline
            </div>
            <div className="flex items-center gap-1">
              <Badge variant="outline">{timelineLanes.length} lanes</Badge>
              <Badge variant="outline">{timelineTransitions.length} hops</Badge>
              <Badge variant="outline">{timeline?.spanMs ?? 0}ms</Badge>
            </div>
          </div>
          <div className="grid gap-1 md:grid-cols-2">
            {timelineLanes.slice(0, 4).map((lane) => {
              const warningCount = lane.levels.warn + lane.levels.error;
              const laneDetail = lane.chatId ?? lane.sessionId ?? lane.source;
              return (
                <div
                  className="grid grid-cols-[1fr_auto] items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/40"
                  key={lane.key}
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono" title={laneDetail}>
                      {lane.label} {shortId(laneDetail)}
                    </div>
                    <div
                      className="truncate text-[11px] text-muted-foreground"
                      title={lane.latestMessage}
                    >
                      {lane.latestKind ?? lane.latestMessage} /{" "}
                      {formatTime(lane.lastTimestamp)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant={warningCount > 0 ? "secondary" : "outline"}>
                      {lane.eventCount}
                    </Badge>
                    {lane.chatId ? (
                      <Button
                        disabled={replayAcpActivity.isPending}
                        onClick={() => {
                          void handleReplayTrace({ chatId: lane.chatId });
                        }}
                        size="xs"
                        title="Replay this chat lane"
                        type="button"
                        variant="ghost"
                      >
                        <Play className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {visibleTimelineFrames.length > 0 ? (
            <div className="mt-2 grid gap-1">
              {visibleTimelineFrames.map((frame) => (
                <div
                  className="grid grid-cols-[52px_76px_1fr] gap-2 rounded px-2 py-1 text-xs hover:bg-muted/30"
                  key={frame.id}
                >
                  <span className="text-muted-foreground">+{frame.offsetMs}ms</span>
                  <span className="truncate font-mono text-muted-foreground">
                    {shortId(frame.chatId ?? frame.laneKey)}
                  </span>
                  <span className="min-w-0 truncate" title={frame.message}>
                    {frame.kind ?? frame.message}
                    {frame.deltaMs ? ` / +${frame.deltaMs}ms` : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {(timeline?.omittedFrames ?? 0) > 0 ? (
            <div className="mt-1 text-muted-foreground text-[11px]">
              {timeline?.omittedFrames} older timeline frame(s) were omitted by
              the timeline limit.
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="border-b p-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="font-medium text-muted-foreground text-[11px] uppercase">
            Saved replays
          </div>
          <Badge variant={replayPresets.length > 0 ? "secondary" : "outline"}>
            {replayPresets.length}
          </Badge>
        </div>
        <div className="flex gap-1.5">
          <Input
            className="h-7 text-xs"
            onChange={(event) => setPresetName(event.target.value)}
            placeholder={
              replay
                ? "Name current replay"
                : primaryChatId
                  ? "Name active chat replay"
                  : "Name workspace replay"
            }
            value={presetName}
          />
          <Button
            disabled={
              !presetName.trim() ||
              (activity?.entries.length ?? 0) === 0 ||
              saveAcpReplayPreset.isPending
            }
            onClick={() => {
              void handleSaveReplayPreset();
            }}
            size="xs"
            type="button"
            variant="outline"
          >
            <Save className="mr-1 h-3 w-3" />
            Save
          </Button>
        </div>
        {replayPresets.length > 0 ? (
          <div className="mt-2 grid gap-1">
            {replayPresets.slice(0, 4).map((preset) => {
              const details = [
                preset.chatId ? `chat ${shortId(preset.chatId)}` : "all chats",
                preset.correlationKey
                  ? `correlation ${shortId(preset.correlationKey)}`
                  : null,
                preset.kind ? `kind ${preset.kind}` : null,
                `${preset.limit} frames`,
              ]
                .filter(Boolean)
                .join(" / ");
              return (
                <div
                  className="grid grid-cols-[1fr_auto] items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/40"
                  key={preset.id}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium" title={preset.name}>
                      {preset.name}
                    </div>
                    <div
                      className="truncate text-[11px] text-muted-foreground"
                      title={details}
                    >
                      {details}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      disabled={replayAcpActivity.isPending}
                      onClick={() => {
                        void handleReplayTrace({
                          ...(preset.chatId ? { chatId: preset.chatId } : {}),
                          ...(preset.correlationKey
                            ? { correlationKey: preset.correlationKey }
                            : {}),
                          ...(preset.kind ? { kind: preset.kind } : {}),
                          limit: preset.limit,
                        });
                      }}
                      size="xs"
                      title="Load replay preset"
                      type="button"
                      variant="ghost"
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                    <Button
                      disabled={deleteAcpReplayPreset.isPending}
                      onClick={() => {
                        void handleDeleteReplayPreset(preset.id);
                      }}
                      size="xs"
                      title="Delete replay preset"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-1 text-muted-foreground text-[11px]">
            No saved replay presets.
          </div>
        )}
      </div>
      {replay ? (
        <div className="border-b bg-muted/10 p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium text-xs">
                Replay {replayFrames.length === 0 ? 0 : replayIndex + 1}/
                {replayFrames.length}
              </div>
              <div className="truncate text-muted-foreground text-[11px]">
                {currentReplayFrame
                  ? `${currentReplayFrame.elapsedMs}ms elapsed / +${currentReplayFrame.deltaMs}ms / ${currentReplayFrame.correlationLabel}`
                  : "No replay frames"}
              </div>
              {replayFilterText ? (
                <div
                  className="truncate text-muted-foreground text-[11px]"
                  title={replayFilterText}
                >
                  {replayFilterText}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                disabled={replayFrames.length === 0 || replayIndex === 0}
                onClick={() => setReplayIndex((current) => Math.max(0, current - 1))}
                size="xs"
                type="button"
                variant="outline"
              >
                <SkipBack className="mr-1 h-3 w-3" />
                Prev
              </Button>
              <Button
                disabled={replayFrames.length <= 1}
                onClick={() => {
                  if (isReplayPlaying) {
                    setIsReplayPlaying(false);
                    return;
                  }
                  if (replayIndex >= replayFrames.length - 1) {
                    setReplayIndex(0);
                  }
                  setIsReplayPlaying(true);
                }}
                size="xs"
                type="button"
                variant="outline"
              >
                {isReplayPlaying ? (
                  <Pause className="mr-1 h-3 w-3" />
                ) : (
                  <Play className="mr-1 h-3 w-3" />
                )}
                {isReplayPlaying ? "Pause" : "Play"}
              </Button>
              <Button
                disabled={
                  replayFrames.length === 0 || replayIndex >= replayFrames.length - 1
                }
                onClick={() =>
                  setReplayIndex((current) =>
                    Math.min(replayFrames.length - 1, current + 1)
                  )
                }
                size="xs"
                type="button"
                variant="outline"
              >
                <SkipForward className="mr-1 h-3 w-3" />
                Next
              </Button>
            </div>
          </div>
          {currentReplayFrame ? (
            <div className="mt-2 rounded border bg-background px-2 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(currentReplayFrame.level)}>
                  {currentReplayFrame.level}
                </Badge>
                <span className="min-w-0 truncate" title={currentReplayFrame.message}>
                  {currentReplayFrame.kind ?? currentReplayFrame.message}
                  {currentReplayFrame.payloadBytes !== undefined
                    ? ` / ${formatBytes(currentReplayFrame.payloadBytes)}`
                    : ""}
                  {currentReplayFrame.chatId
                    ? ` / ${shortId(currentReplayFrame.chatId)}`
                    : ""}
                </span>
              </div>
              {currentReplayMetadata ? (
                <div
                  className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                  title={currentReplayMetadata}
                >
                  {currentReplayMetadata}
                </div>
              ) : null}
            </div>
          ) : null}
          {replay.diagnostics.length > 0 ? (
            <div className="mt-1 text-muted-foreground text-[11px]">
              {replay.diagnostics.join(" ")}
            </div>
          ) : null}
        </div>
      ) : null}
      {visibleReplayKinds.length > 0 ? (
        <div className="border-b p-2">
          <div className="mb-1.5 font-medium text-muted-foreground text-[11px] uppercase">
            Replay by kind
          </div>
          <div className="flex flex-wrap gap-1.5">
            {visibleReplayKinds.map(([kind, count]) => (
              <Button
                disabled={replayAcpActivity.isPending}
                key={kind}
                onClick={() => {
                  void handleReplayTrace({ kind });
                }}
                size="xs"
                type="button"
                variant={replay?.filters.kind === kind ? "secondary" : "outline"}
              >
                <Play className="mr-1 h-3 w-3" />
                {kind} {count}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {(activity?.correlations.length ?? 0) > 0 ? (
        <div className="border-b p-2">
          <div className="mb-1.5 font-medium text-muted-foreground text-[11px] uppercase">
            Correlations
          </div>
          <div className="grid gap-1">
            {(activity?.correlations ?? []).slice(0, 4).map((correlation) => {
              const warningCount =
                correlation.levels.warn + correlation.levels.error;
              const detailId =
                correlation.turnId ??
                correlation.sessionId ??
                correlation.chatId ??
                correlation.key;
              return (
                <div
                  className="grid grid-cols-[72px_1fr_86px] gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/40"
                  key={correlation.key}
                >
                  <span className="truncate text-muted-foreground">
                    {correlation.label}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-mono">
                      {shortId(detailId)}
                    </span>
                    <span
                      className="block truncate text-[11px] text-muted-foreground"
                      title={correlation.latestMessage}
                    >
                      {correlation.latestMessage}
                    </span>
                  </span>
                  <span className="flex items-center justify-end gap-1">
                    <Badge variant={warningCount > 0 ? "secondary" : "outline"}>
                      {correlation.eventCount}
                    </Badge>
                    <Button
                      disabled={replayAcpActivity.isPending}
                      onClick={() => {
                        void handleReplayTrace({
                          ...(correlation.chatId ? { chatId: correlation.chatId } : {}),
                          correlationKey: correlation.key,
                        });
                      }}
                      size="xs"
                      type="button"
                      variant="ghost"
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="max-h-64 overflow-y-auto p-2">
        {(activity?.entries ?? []).map((entry) => {
          const metadata = Object.entries(entry.metadata)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(" ");
          return (
            <div
              className="grid grid-cols-[56px_52px_1fr] gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/40"
              key={entry.id}
            >
              <span className="text-muted-foreground">{formatTime(entry.timestamp)}</span>
              <Badge variant={statusVariant(entry.level)}>{entry.level}</Badge>
              <span className="min-w-0">
                <span className="block truncate" title={entry.message}>
                  {entry.kind ?? entry.message}
                  {entry.payloadBytes !== undefined
                    ? ` / ${formatBytes(entry.payloadBytes)}`
                    : ""}
                  {entry.chatId ? ` / ${shortId(entry.chatId)}` : ""}
                </span>
                {metadata ? (
                  <span className="block truncate font-mono text-[11px] text-muted-foreground" title={metadata}>
                    {metadata}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
        {(activity?.entries.length ?? 0) === 0 ? (
          <div className="p-2 text-muted-foreground text-sm">
            No ACP activity captured yet.
          </div>
        ) : null}
      </div>
      {(activity?.diagnostics.length ?? 0) > 0 ? (
        <div className="border-t px-3 py-2 text-muted-foreground text-xs">
          {activity?.diagnostics.join(" ")}
        </div>
      ) : null}
    </div>
  );
}

function LogsAndParity({ snapshot }: { snapshot: LocalAdeSnapshot | undefined }) {
  return (
    <div className="grid gap-3 xl:grid-cols-3">
      <AcpActivityPanel snapshot={snapshot} />
      <div className="rounded-md border">
        <div className="border-b px-3 py-2 font-medium text-xs uppercase">
          Runtime Timeline
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {(snapshot?.logs.entries ?? []).map((entry) => (
            <div className="grid grid-cols-[56px_54px_1fr] gap-2 rounded px-2 py-1 text-xs" key={entry.id}>
              <span className="text-muted-foreground">{formatTime(entry.timestamp)}</span>
              <Badge variant={statusVariant(entry.level)}>{entry.level}</Badge>
              <span className="truncate" title={entry.message}>
                {entry.source}: {entry.message}
              </span>
            </div>
          ))}
          {(snapshot?.logs.entries.length ?? 0) === 0 ? (
            <div className="p-2 text-muted-foreground text-sm">No logs yet.</div>
          ) : null}
        </div>
      </div>
      <div className="rounded-md border">
        <div className="border-b px-3 py-2 font-medium text-xs uppercase">
          Dashboard Parity
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {(snapshot?.dashboardParity ?? []).map((item) => (
            <div className="rounded px-2 py-2 text-xs" key={item.workflow}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{item.workflow}</span>
                <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
              </div>
              <div className="mt-1 text-muted-foreground">
                {item.reason ?? item.electronSurface}
              </div>
              {item.policy ? (
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                  <Badge variant={statusVariant(item.policy.decision)}>
                    {item.policy.decision}
                  </Badge>
                  <span>{item.policy.scope}</span>
                  <span>{item.policy.reviewedAt}</span>
                </div>
              ) : null}
              {item.blockerFile ? (
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {item.blockerFile}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LocalAdeControlCenter({
  className,
  compact = false,
  onOpenSession,
  onStartSession,
  onSubmitCommand,
  showHeader = true,
  visibleSections,
}: LocalAdeControlCenterProps) {
  const utils = trpc.useUtils();
  const desktopBootstrap = useServerConfigStore((state) => state.desktopBootstrap);
  const [isTestingProviders, setIsTestingProviders] = React.useState(false);
  const [isProbingMcp, setIsProbingMcp] = React.useState(false);
  const [diagnostics, setDiagnostics] = React.useState<RuntimeDiagnostics | null>(
    desktopBootstrap?.runtimeDiagnostics ?? null
  );
  const snapshotQuery = trpc.settings.getLocalAdeSnapshot.useQuery(undefined, {
    refetchInterval: compact ? false : 5000,
  });
  const updateCapability = trpc.settings.updateCapabilityState.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
    },
    onError: (error) => toast.error(error.message),
  });
  const testProvider = trpc.settings.testProvider.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
    },
  });
  const createCheckpoint = trpc.settings.createCheckpoint.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Checkpoint captured");
      scrollToLocalAdeSection("local-ade-change-trust");
    },
    onError: (error) => toast.error(error.message),
  });
  const probeMcpServer = trpc.settings.probeMcpServer.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
    },
  });
  const refreshProjectIndex = trpc.settings.refreshProjectIndex.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Project index refreshed");
      scrollToLocalAdeSection("local-ade-project-index");
    },
    onError: (error) => toast.error(error.message),
  });

  const refetchSnapshot = snapshotQuery.refetch;
  const refreshDiagnostics = React.useCallback(async () => {
    try {
      const next = await window.eragearDesktop?.getRuntimeDiagnostics?.();
      if (next && typeof next === "object") {
        setDiagnostics(next as RuntimeDiagnostics);
      }
      await refetchSnapshot();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Diagnostics refresh failed");
    }
  }, [refetchSnapshot]);

  React.useEffect(() => {
    let disposed = false;
    async function loadRuntimeDiagnostics() {
      const next = await window.eragearDesktop?.getRuntimeDiagnostics?.();
      if (!disposed && next && typeof next === "object") {
        setDiagnostics(next as RuntimeDiagnostics);
      }
    }
    void loadRuntimeDiagnostics();
    return () => {
      disposed = true;
    };
  }, []);

  const snapshot = snapshotQuery.data;
  const capabilities = snapshot?.capabilities.capabilities ?? [];
  const operationSummary = getLocalAdeOperationSummary({ diagnostics, snapshot });

  const handleTestProviders = React.useCallback(async () => {
    const providerIds = operationSummary.providers.probeTargets;
    if (providerIds.length === 0) {
      toast.info("No probeable providers.");
      return;
    }
    setIsTestingProviders(true);
    let failed = 0;
    try {
      for (const providerId of providerIds) {
        try {
          await testProvider.mutateAsync({ providerId });
        } catch (error) {
          failed += 1;
          console.error("Provider probe failed", error);
        }
      }
      await refetchSnapshot();
      if (failed > 0) {
        toast.error(`Provider probes finished with ${failed} failure(s).`);
      } else {
        toast.success(`Provider probes completed (${providerIds.length}).`);
      }
      scrollToLocalAdeSection("local-ade-providers");
    } finally {
      setIsTestingProviders(false);
    }
  }, [operationSummary.providers.probeTargets, refetchSnapshot, testProvider]);

  const handleProbeMcpServers = React.useCallback(async () => {
    const servers = (snapshot?.mcp.servers ?? []).filter((server) => server.enabled);
    if (servers.length === 0) {
      toast.info("No enabled MCP servers.");
      scrollToLocalAdeSection("local-ade-mcp");
      return;
    }
    setIsProbingMcp(true);
    let failed = 0;
    try {
      for (const server of servers) {
        try {
          await probeMcpServer.mutateAsync({ id: server.id });
        } catch (error) {
          failed += 1;
          console.error("MCP probe failed", error);
        }
      }
      await refetchSnapshot();
      if (failed > 0) {
        toast.error(`MCP probes finished with ${failed} failure(s).`);
      } else {
        toast.success(`MCP probes completed (${servers.length}).`);
      }
      scrollToLocalAdeSection("local-ade-mcp");
    } finally {
      setIsProbingMcp(false);
    }
  }, [probeMcpServer, refetchSnapshot, snapshot?.mcp.servers]);

  const handleCopyCommand = React.useCallback(async (command: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("Clipboard unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(command);
      toast.success("Command copied");
    } catch (error) {
      console.error("Command copy failed", error);
      toast.error("Failed to copy command");
    }
  }, []);
  const visibleSectionSet = React.useMemo(
    () => new Set(visibleSections ?? LOCAL_ADE_CONTROL_CENTER_SECTIONS),
    [visibleSections]
  );
  const hasSection = (section: LocalAdeControlCenterSection) =>
    visibleSectionSet.has(section);
  const hasMemoryOrMcp = hasSection("memory") || hasSection("mcp");
  const splitMemoryAndMcp =
    !compact && hasSection("memory") && hasSection("mcp");

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4", className)}>
      {showHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-xl tracking-tight">
              Local ADE Control Center
            </h2>
            <p className="mt-1 truncate text-muted-foreground text-sm">
              {shortPath(snapshot?.projectRoot)} - Electron IPC/private desktop-service
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              disabled={snapshotQuery.isFetching}
              onClick={() => {
                void refreshDiagnostics();
              }}
              size="sm"
              variant="outline"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      ) : null}

      {hasSection("overview") ? (
        <WorkflowActionStrip
          diagnostics={diagnostics}
          isCreatingCheckpoint={createCheckpoint.isPending}
          isProbingMcp={isProbingMcp}
          isRefreshing={snapshotQuery.isFetching}
          isRefreshingIndex={refreshProjectIndex.isPending}
          isTestingProviders={isTestingProviders}
          onCopyCommand={handleCopyCommand}
          onCreateCheckpoint={() => createCheckpoint.mutate({})}
          onOpenSession={onOpenSession}
          onProbeMcp={() => {
            void handleProbeMcpServers();
          }}
          onRefreshIndex={() => refreshProjectIndex.mutate({})}
          onRefreshRuntime={() => {
            scrollToLocalAdeSection("local-ade-runtime");
            void refreshDiagnostics();
          }}
          onStartSession={onStartSession}
          onSubmitCommand={onSubmitCommand}
          onTestProviders={() => {
            void handleTestProviders();
          }}
          snapshot={snapshot}
        />
      ) : null}

      {hasSection("runtime") ? (
        <div id="local-ade-runtime">
          <RuntimeStrip diagnostics={diagnostics} snapshot={snapshot} />
        </div>
      ) : null}

      {hasSection("providers") ? (
        <div
          className={cn(
            "grid gap-3",
            compact ? "xl:grid-cols-1" : "2xl:grid-cols-[1fr_1fr]"
          )}
        >
          <Section title="Agent CLI Detection" icon={Terminal}>
            <CliGrid diagnostics={diagnostics} />
          </Section>

          <Section id="local-ade-providers" title="Provider And Agent State" icon={KeyRound}>
            <ProviderTable snapshot={snapshot} />
          </Section>
        </div>
      ) : null}

      {hasSection("capabilities") ? (
        <Section
          id="local-ade-capabilities"
          action={
            <Badge variant={statusVariant(snapshot?.capabilities.diagnostics.status)}>
              {snapshot?.capabilities.diagnostics.status ?? "loading"}
            </Badge>
          }
          icon={SlidersHorizontal}
          title="Capability Registry"
        >
          <CapabilityRows
            capabilities={capabilities}
            disabled={updateCapability.isPending}
            onToggle={(capability, enabled) =>
              updateCapability.mutate({
                capabilityId: capability.id,
                enabled,
              })
            }
          />
        </Section>
      ) : null}

      {hasSection("hooks") ? (
        <Section
          action={<Badge variant="outline">{snapshot?.hooks.items.length ?? 0}</Badge>}
          icon={Play}
          title="Hooks"
        >
          <HookRunner snapshot={snapshot} />
        </Section>
      ) : null}

      {hasSection("plugins") ? (
        <Section
          action={<Badge variant="outline">{snapshot?.plugins.items.length ?? 0}</Badge>}
          icon={PlugZap}
          title="Plugins"
        >
          <PluginRunner snapshot={snapshot} />
        </Section>
      ) : null}

      {hasMemoryOrMcp ? (
        <div
          className={cn(
            "grid gap-3",
            splitMemoryAndMcp ? "2xl:grid-cols-[1fr_1fr]" : "xl:grid-cols-1"
          )}
        >
          {hasSection("memory") ? (
            <Section id="local-ade-change-trust" title="Project Memory And Change Trust" icon={FileText}>
              <MemoryAndTrust snapshot={snapshot} />
            </Section>
          ) : null}

          {hasSection("mcp") ? (
            <Section id="local-ade-mcp" title="MCP Servers" icon={PlugZap}>
              <McpManager
                onProbe={() => {
                  void refreshDiagnostics();
                  toast.success("MCP probes refreshed");
                }}
                snapshot={snapshot}
              />
            </Section>
          ) : null}
        </div>
      ) : null}

      {hasSection("project-index") ? (
        <Section
          action={
            <Badge variant={snapshot?.projectIndex.indexedAt ? "default" : "outline"}>
              {snapshot?.projectIndex.indexedAt ? "ready" : "not indexed"}
            </Badge>
          }
          icon={Database}
          id="local-ade-project-index"
          title="Project Index"
        >
          <ProjectIndex snapshot={snapshot} />
        </Section>
      ) : null}

      {hasSection("activity") ? (
        <Section title="Runtime Logs And Dashboard Parity" icon={GitBranch}>
          <LogsAndParity snapshot={snapshot} />
        </Section>
      ) : null}

      {hasSection("storage") ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <StatTile
            detail={`${snapshot?.storage?.messageCount ?? 0} messages`}
            icon={Database}
            label="SQLite Store"
            value={formatBytes(snapshot?.storage?.dbSizeBytes)}
          />
          <StatTile
            detail={snapshot?.blockers.map((item) => item.workflow).join(", ") || "No local blockers"}
            icon={ShieldAlert}
            label="Explicit Blockers"
            value={snapshot?.blockers.length ?? 0}
          />
          <StatTile
            detail={diagnostics?.childProcess.message}
            icon={Activity}
            label="Runtime PID"
            value={diagnostics?.childProcess.pid ?? "n/a"}
          />
        </div>
      ) : null}
    </div>
  );
}
