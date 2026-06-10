"use client";

import type { inferRouterOutputs } from "@trpc/server";
import type { RuntimeDiagnostics } from "@repo/shared";
import {
  Activity,
  Bot,
  CheckCircle2,
  Database,
  Eye,
  FileText,
  GitBranch,
  KeyRound,
  PlugZap,
  RefreshCw,
  Save,
  ServerCog,
  ShieldAlert,
  SlidersHorizontal,
  Terminal,
  TestTube2,
  Undo2,
  XCircle,
} from "lucide-react";
import React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { type AppRouter, trpc } from "@/lib/trpc";
import { useServerConfigStore } from "@/store/server-config-store";

type RouterOutput = inferRouterOutputs<AppRouter>;
type LocalAdeSnapshot = RouterOutput["settings"]["getLocalAdeSnapshot"];
type Capability = LocalAdeSnapshot["capabilities"]["capabilities"][number];
type CheckpointPreview = RouterOutput["settings"]["previewCheckpoint"];
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
  if (value === true || value === "ready" || value === "available") {
    return "default";
  }
  if (
    value === false ||
    value === "error" ||
    value === "blocked" ||
    value === "unavailable" ||
    value === "invalid-config"
  ) {
    return "destructive";
  }
  if (
    value === "partial" ||
    value === "degraded" ||
    value === "missing-config" ||
    value === "disabled"
  ) {
    return "secondary";
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
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-md border bg-background">
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
      <div className="grid grid-cols-[1fr_0.7fr_0.8fr_1fr_88px] border-b bg-muted/30 px-3 py-2 font-medium text-xs">
        <span>Provider</span>
        <span>Kind</span>
        <span>Status</span>
        <span>Safe Config</span>
        <span>Action</span>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {providers.map((provider) => (
          <div
            className="grid grid-cols-[1fr_0.7fr_0.8fr_1fr_88px] gap-2 border-b px-3 py-2 text-sm last:border-b-0"
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
            <span className="truncate text-muted-foreground text-xs">
              {provider.redactedEnvKeys.length > 0
                ? `${provider.redactedEnvKeys.join(", ")} configured`
                : "No provider secrets stored in agent config"}
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
  const upsert = trpc.settings.upsertMcpServer.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setName("");
      setCommandOrUrl("");
      toast.success("MCP server saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const toggle = trpc.settings.toggleMcpServer.useMutation({
    onSuccess: (data) => utils.settings.getLocalAdeSnapshot.setData(undefined, data),
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
            {transport === "stdio" ? "Command" : "URL"}
          </Label>
          <Input
            value={commandOrUrl}
            onChange={(event) => setCommandOrUrl(event.target.value)}
          />
        </div>
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
              </div>
              <div className="truncate text-muted-foreground text-xs">
                {server.command ?? server.url ?? "missing target"}
                {server.envKeys.length > 0
                  ? `; env: ${server.envKeys.join(", ")}`
                  : ""}
              </div>
              <div className="truncate text-muted-foreground text-[11px]">
                {server.latencyMs !== undefined
                  ? `${server.latencyMs}ms - ${server.diagnostics[0] ?? "probed"}`
                  : server.diagnostics[0] ?? "not probed"}
              </div>
            </div>
            <Switch
              checked={server.enabled}
              disabled={toggle.isPending}
              onCheckedChange={(enabled) =>
                toggle.mutate({ id: server.id, enabled })
              }
              size="sm"
            />
          </div>
        ))}
        {(snapshot?.mcp.servers.length ?? 0) === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
            No MCP servers configured. Entries are saved to{" "}
            <code>{shortPath(snapshot?.mcp.configPath)}</code>.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MemoryAndTrust({ snapshot }: { snapshot: LocalAdeSnapshot | undefined }) {
  const utils = trpc.useUtils();
  const [checkpointPreview, setCheckpointPreview] =
    React.useState<CheckpointPreview | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = React.useState("");
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
    },
    onError: (error) => toast.error(error.message),
  });
  const restoreCheckpoint = trpc.settings.restoreCheckpoint.useMutation({
    onSuccess: (data) => {
      utils.settings.getLocalAdeSnapshot.setData(undefined, data);
      setCheckpointPreview(null);
      setRestoreConfirmation("");
      toast.success("Checkpoint restored");
    },
    onError: (error) => toast.error(error.message),
  });

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
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {shortPath(checkpoint.patchPath)}
                </div>
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
              <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[11px]">
                {checkpointPreview.preview || "Patch is empty."}
              </pre>
              {checkpointPreview.restoreBlockers.length > 0 ? (
                <div className="mt-2 space-y-1 text-muted-foreground text-[11px]">
                  {checkpointPreview.restoreBlockers.map((blocker) => (
                    <div key={`${blocker.file}:${blocker.reason}`}>
                      {blocker.file}: {blocker.reason}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
                  <Input
                    aria-label="Checkpoint restore confirmation"
                    onChange={(event) => setRestoreConfirmation(event.target.value)}
                    placeholder={`Type ${checkpointPreview.restoreToken}`}
                    value={restoreConfirmation}
                  />
                  <Button
                    disabled={
                      restoreCheckpoint.isPending ||
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
                    Restore
                  </Button>
                </div>
              )}
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

function LogsAndParity({ snapshot }: { snapshot: LocalAdeSnapshot | undefined }) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
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
          {onStartSession ? (
            <Button onClick={onStartSession} size="sm">
              <Terminal className="mr-2 h-4 w-4" />
              Start Session
            </Button>
          ) : null}
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

      <RuntimeStrip diagnostics={diagnostics} snapshot={snapshot} />

      <div className={cn("grid gap-3", compact ? "xl:grid-cols-1" : "2xl:grid-cols-[1fr_1fr]")}>
        <Section title="Agent CLI Detection" icon={Terminal}>
          <CliGrid diagnostics={diagnostics} />
        </Section>

        <Section title="Provider And Agent State" icon={KeyRound}>
          <ProviderTable snapshot={snapshot} />
        </Section>
      </div>

      <Section
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

      <div className={cn("grid gap-3", compact ? "xl:grid-cols-1" : "2xl:grid-cols-[1fr_1fr]")}>
        <Section title="Project Memory And Change Trust" icon={FileText}>
          <MemoryAndTrust snapshot={snapshot} />
        </Section>

        <Section title="MCP Servers" icon={PlugZap}>
          <McpManager
            onProbe={() => {
              void refreshDiagnostics();
              toast.success("MCP probes refreshed");
            }}
            snapshot={snapshot}
          />
        </Section>
      </div>

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
