"use client";

import type { inferRouterOutputs } from "@trpc/server";
import type { RuntimeDiagnostics } from "@repo/shared";
import {
  Activity,
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
  RefreshCw,
  Save,
  ServerCog,
  ShieldAlert,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  Terminal,
  TestTube2,
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
  getLocalAdeOperationSummary,
  getLocalAdeRunActions,
  getLocalAdeWorkspaceFocus,
  getLocalAdeWorkflowLanes,
  type LocalAdeRunAction,
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

interface LocalAdeControlCenterProps {
  className?: string;
  compact?: boolean;
  onStartSession?: () => void;
}

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
    value === "added" ||
    value === "ok" ||
    value === "injectable"
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
    value === "changed" ||
    value === "deleted" ||
    value === "timeout"
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
    value === "cli-ok" ||
    value === "auth-unknown" ||
    value === "model-unknown" ||
    value === "unknown" ||
    value === "unsupported" ||
    value === "attention"
  ) {
    return "secondary";
  }
  if (value === "conditional" || value === "skipped") {
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

function WorkflowActionStrip({
  diagnostics,
  snapshot,
  onStartSession,
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
  onStartSession?: () => void;
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
              onClick={onStartSession}
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

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
  const providers = snapshot?.providers ?? [];
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="grid grid-cols-[1fr_0.55fr_0.75fr_1.15fr_1fr_88px] border-b bg-muted/30 px-3 py-2 font-medium text-xs">
        <span>Provider</span>
        <span>Kind</span>
        <span>Ready</span>
        <span>Probe Detail</span>
        <span>Safe Config</span>
        <span>Action</span>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {providers.map((provider) => (
          <div
            className="grid grid-cols-[1fr_0.55fr_0.75fr_1.15fr_1fr_88px] gap-2 border-b px-3 py-2 text-sm last:border-b-0"
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
            </span>
            <span className="truncate text-muted-foreground">{provider.providerKind}</span>
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
            <span className="truncate text-muted-foreground text-xs">
              {provider.redactedEnvKeys.length > 0
                ? `${provider.redactedEnvKeys.join(", ")} configured`
                : "No provider secrets stored in agent config"}
              {provider.modelList.length > 0
                ? `; models: ${provider.modelList.slice(0, 3).join(", ")}`
                : ""}
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
        ))}
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
                {snapshot.mcp.agentRouting.injectableCount} direct
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
        {(snapshot?.mcp.servers ?? []).map((server) => (
          <div
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            key={server.id}
          >
            <div className="min-w-0">
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
        ))}
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
  const [command, setCommand] = React.useState("");
  const [argsText, setArgsText] = React.useState("");
  const [envKeysText, setEnvKeysText] = React.useState("");
  const [workingDirectory, setWorkingDirectory] = React.useState("");
  const [timeoutMs, setTimeoutMs] = React.useState("10000");
  const upsertHook = trpc.settings.upsertHook.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setName("");
      setEvent("manual");
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
  const trustHook = trpc.settings.trustHook.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Hook trusted");
    },
    onError: (error) => toast.error(error.message),
  });
  const runHook = trpc.settings.runHook.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Hook executed");
    },
    onError: (error) => toast.error(error.message),
  });

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

  return (
    <div className="space-y-3">
      <div className="grid gap-2 xl:grid-cols-[1fr_120px_1fr_90px]">
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
      <div className="grid gap-2 xl:grid-cols-[1fr_1fr_1fr_auto]">
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
        {hooks.map((hook) => (
          <div className="rounded-md border p-3" key={hook.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-sm">{hook.name}</span>
                  <Badge variant={hook.enabled ? "default" : "outline"}>
                    {hook.enabled ? "enabled" : "off"}
                  </Badge>
                  <Badge variant="outline">{hook.event}</Badge>
                  <Badge variant={statusVariant(hook.trustStatus)}>
                    {hook.trustStatus}
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
              </div>
              <div className="flex shrink-0 items-center gap-2">
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
                    runHook.isPending ||
                    !hook.enabled ||
                    hook.trustStatus !== "trusted"
                  }
                  onClick={() => runHook.mutate({ hookId: hook.id })}
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
            {hook.lastRun ? (
              <div className="mt-3 grid gap-2 xl:grid-cols-2">
                <div className="min-w-0 rounded bg-muted/30 p-2">
                  <div className="mb-1 text-muted-foreground text-[11px]">
                    stdout - {formatTime(hook.lastRun.finishedAt)} -{" "}
                    {hook.lastRun.durationMs}ms
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
            ) : null}
          </div>
        ))}
        {hooks.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
            No hooks configured. Add a manual hook to create an executable
            project-local hook surface.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PluginRunner({ snapshot }: { snapshot: LocalAdeSnapshot | undefined }) {
  const utils = trpc.useUtils();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [command, setCommand] = React.useState("");
  const [argsText, setArgsText] = React.useState("");
  const [envKeysText, setEnvKeysText] = React.useState("");
  const [workingDirectory, setWorkingDirectory] = React.useState("");
  const [timeoutMs, setTimeoutMs] = React.useState("10000");
  const upsertPlugin = trpc.settings.upsertPlugin.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setName("");
      setDescription("");
      setCommand("");
      setArgsText("");
      setEnvKeysText("");
      setWorkingDirectory("");
      setTimeoutMs("10000");
      toast.success("Plugin saved");
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
  const runPlugin = trpc.settings.runPlugin.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      toast.success("Plugin executed");
    },
    onError: (error) => toast.error(error.message),
  });

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
    const scopes = [
      "process",
      "project-root",
      ...(envKeys.length > 0 ? ["env"] : []),
    ] as Array<"process" | "project-root" | "env">;
    upsertPlugin.mutate({
      name: trimmedName,
      ...(description.trim() ? { description: description.trim() } : {}),
      scopes,
      envKeys,
      command: trimmedCommand,
      args: parseHookArgsText(argsText),
      timeoutMs: Math.floor(parsedTimeout),
      ...(workingDirectory.trim()
        ? { workingDirectory: workingDirectory.trim() }
        : {}),
    });
  };

  const plugins = snapshot?.plugins.items ?? [];

  return (
    <div className="space-y-3">
      <div className="grid gap-2 xl:grid-cols-[1fr_1fr_1fr_90px]">
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
      <div className="grid gap-2 xl:grid-cols-[1fr_1fr_1fr_auto]">
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
            {shortPath(snapshot?.plugins.configPath)}
          </div>
        </div>
        <div className="flex items-end">
          <Button disabled={upsertPlugin.isPending} onClick={save} size="sm">
            Save Plugin
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        {plugins.map((plugin) => (
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
                  {plugin.scopes.map((scope) => (
                    <Badge key={scope} variant="outline">
                      {scope}
                    </Badge>
                  ))}
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
                    : "cwd project root; "}
                  timeout {plugin.timeoutMs}ms
                </div>
                <div className="mt-1 truncate text-muted-foreground text-[11px]">
                  env {plugin.envKeys.length > 0 ? plugin.envKeys.join(", ") : "none"}
                </div>
                <div className="mt-1 truncate font-mono text-muted-foreground text-[11px]">
                  {plugin.fingerprint}
                  {plugin.trustedAt ? `; trusted ${formatTime(plugin.trustedAt)}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
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
                  disabled={
                    runPlugin.isPending ||
                    !plugin.enabled ||
                    plugin.trustStatus !== "trusted"
                  }
                  onClick={() => runPlugin.mutate({ pluginId: plugin.id })}
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
            {plugin.lastRun ? (
              <div className="mt-3 grid gap-2 xl:grid-cols-2">
                <div className="min-w-0 rounded bg-muted/30 p-2">
                  <div className="mb-1 text-muted-foreground text-[11px]">
                    stdout - {formatTime(plugin.lastRun.finishedAt)} -{" "}
                    {plugin.lastRun.durationMs}ms
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
            ) : null}
          </div>
        ))}
        {plugins.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
            No plugins configured. Add a project-local plugin to create an
            executable plugin surface.
          </div>
        ) : null}
      </div>
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
          detail={(index?.diagnostics ?? [])[0] ?? "Metadata and code signals"}
          icon={ShieldAlert}
          label="Index Status"
          value={index?.indexedAt ? "ready" : "empty"}
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
  const updateMemory = trpc.settings.updateCapabilityState.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
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
      const patchFiles = new Set(data.diffFiles.map((file) => file.path));
      setSelectedCheckpointFiles(
        data.restoreRisks
          .filter((risk) => risk.level === "safe" && patchFiles.has(risk.file))
          .map((risk) => risk.file)
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

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="space-y-2">
        {(snapshot?.projectMemory.sources ?? []).map((source) => (
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
        {(snapshot?.projectMemory.sources.length ?? 0) === 0 ? (
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
                    {restore.safetyCheckpointId ? ` - safety ${restore.safetyCheckpointId}` : ""}
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
                                disabled={checkpointRiskByFile.get(file.path)?.level !== "safe"}
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
                  <Button
                    disabled={
                      restoreCheckpointHunks.isPending ||
                      selectedCheckpointHunks.length === 0 ||
                      restoreConfirmation.trim() !== checkpointPreview.restoreToken
                    }
                    onClick={() =>
                      restoreCheckpointHunks.mutate({
                        checkpointId: checkpointPreview.checkpointId,
                        confirmation: restoreConfirmation,
                        hunks: selectedCheckpointHunks,
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
  const activity = snapshot?.acpActivity;
  const exportAcpActivity = trpc.settings.exportAcpActivity.useMutation();
  const replayAcpActivity = trpc.settings.replayAcpActivity.useMutation();
  const [replay, setReplay] = React.useState<AcpActivityReplay | null>(null);
  const [replayIndex, setReplayIndex] = React.useState(0);
  const [isReplayPlaying, setIsReplayPlaying] = React.useState(false);
  const kindSummary = Object.entries(activity?.stats.kinds ?? {})
    .slice(0, 4)
    .map(([kind, count]) => `${kind} ${count}`)
    .join(", ");
  const primaryChatId = activity?.entries.find((entry) => entry.chatId)?.chatId;
  const replayFrames = replay?.frames ?? [];
  const currentReplayFrame = replayFrames[replayIndex];
  const currentReplayMetadata = currentReplayFrame
    ? Object.entries(currentReplayFrame.metadata)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")
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
  const handleReplayTrace = React.useCallback(
    async (params: { chatId?: string; correlationKey?: string } = {}) => {
      try {
        const nextReplay = await replayAcpActivity.mutateAsync({
          ...(params.chatId ?? primaryChatId
            ? { chatId: params.chatId ?? primaryChatId }
            : {}),
          ...(params.correlationKey ? { correlationKey: params.correlationKey } : {}),
          limit: 120,
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
  onStartSession,
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

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4", className)}>
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

      <WorkflowActionStrip
        diagnostics={diagnostics}
        isCreatingCheckpoint={createCheckpoint.isPending}
        isProbingMcp={isProbingMcp}
        isRefreshing={snapshotQuery.isFetching}
        isRefreshingIndex={refreshProjectIndex.isPending}
        isTestingProviders={isTestingProviders}
        onCopyCommand={handleCopyCommand}
        onCreateCheckpoint={() => createCheckpoint.mutate({})}
        onProbeMcp={() => {
          void handleProbeMcpServers();
        }}
        onRefreshIndex={() => refreshProjectIndex.mutate({})}
        onRefreshRuntime={() => {
          scrollToLocalAdeSection("local-ade-runtime");
          void refreshDiagnostics();
        }}
        onStartSession={onStartSession}
        onTestProviders={() => {
          void handleTestProviders();
        }}
        snapshot={snapshot}
      />

      <div id="local-ade-runtime">
        <RuntimeStrip diagnostics={diagnostics} snapshot={snapshot} />
      </div>

      <div className={cn("grid gap-3", compact ? "xl:grid-cols-1" : "2xl:grid-cols-[1fr_1fr]")}>
        <Section title="Agent CLI Detection" icon={Terminal}>
          <CliGrid diagnostics={diagnostics} />
        </Section>

        <Section id="local-ade-providers" title="Provider And Agent State" icon={KeyRound}>
          <ProviderTable snapshot={snapshot} />
        </Section>
      </div>

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

      <Section
        action={<Badge variant="outline">{snapshot?.hooks.items.length ?? 0}</Badge>}
        icon={Play}
        title="Hooks"
      >
        <HookRunner snapshot={snapshot} />
      </Section>

      <Section
        action={<Badge variant="outline">{snapshot?.plugins.items.length ?? 0}</Badge>}
        icon={PlugZap}
        title="Plugins"
      >
        <PluginRunner snapshot={snapshot} />
      </Section>

      <div className={cn("grid gap-3", compact ? "xl:grid-cols-1" : "2xl:grid-cols-[1fr_1fr]")}>
        <Section id="local-ade-change-trust" title="Project Memory And Change Trust" icon={FileText}>
          <MemoryAndTrust snapshot={snapshot} />
        </Section>

        <Section id="local-ade-mcp" title="MCP Servers" icon={PlugZap}>
          <McpManager
            onProbe={() => {
              void refreshDiagnostics();
              toast.success("MCP probes refreshed");
            }}
            snapshot={snapshot}
          />
        </Section>
      </div>

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

      <Section title="Runtime Logs And Dashboard Parity" icon={GitBranch}>
        <LogsAndParity snapshot={snapshot} />
      </Section>

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
    </div>
  );
}
