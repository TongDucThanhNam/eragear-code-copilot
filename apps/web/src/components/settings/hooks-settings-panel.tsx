"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  AlertCircle,
  Edit2,
  RefreshCw,
  Save,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import * as React from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type Hook = RouterOutput["hooks"]["list"]["hooks"][number];
type HookFailureMode = RouterOutput["hooks"]["list"]["lifecyclePolicy"]["failureMode"];
type HookPolicyPreset = Hook["policyPreset"];

const HOOK_EVENT_OPTIONS = [
  "manual",
  "after-agent-session-create",
  "after-agent-message-send",
  "after-agent-turn-complete",
  "after-agent-session-stop",
  "after-project-index-refresh",
  "after-checkpoint-create",
  "after-checkpoint-restore",
] as const;

const HOOK_POLICY_PRESETS: HookPolicyPreset[] = [
  "standard",
  "restricted",
  "blocked",
];

interface HookDraft {
  id: string;
  name: string;
  event: string;
  command: string;
  argsText: string;
  timeoutMs: string;
  policyPreset: HookPolicyPreset;
  enabled: boolean;
}

const EMPTY_DRAFT: HookDraft = {
  id: "",
  name: "",
  event: "manual",
  command: "",
  argsText: "",
  timeoutMs: "5000",
  policyPreset: "standard",
  enabled: true,
};

export function HooksSettingsPanel() {
  const utils = trpc.useUtils();
  const [draft, setDraft] = React.useState<HookDraft>(EMPTY_DRAFT);
  const hooksQuery = trpc.hooks.list.useQuery(undefined, {
    staleTime: 30_000,
  });

  const updateHooksCache = React.useCallback(
    async (data: RouterOutput["hooks"]["list"]) => {
      utils.hooks.list.setData(undefined, data);
      await utils.settings.getLocalAdeSnapshot.invalidate();
    },
    [utils]
  );

  const upsertHook = trpc.hooks.upsert.useMutation({
    onSuccess: async (data) => {
      await updateHooksCache(data);
      setDraft(EMPTY_DRAFT);
      toast.success("Hook saved");
    },
    onError: (error) => toast.error(error.message || "Failed to save hook"),
  });
  const toggleHook = trpc.hooks.toggle.useMutation({
    onSuccess: updateHooksCache,
    onError: (error) => toast.error(error.message || "Failed to toggle hook"),
  });
  const updateLifecyclePolicy = trpc.hooks.updateLifecyclePolicy.useMutation({
    onSuccess: updateHooksCache,
    onError: (error) =>
      toast.error(error.message || "Failed to update lifecycle policy"),
  });

  const hooks = hooksQuery.data?.hooks ?? [];
  const lifecyclePolicy = hooksQuery.data?.lifecyclePolicy;
  const isBusy =
    hooksQuery.isLoading ||
    hooksQuery.isFetching ||
    upsertHook.isPending ||
    toggleHook.isPending ||
    updateLifecyclePolicy.isPending;

  const saveDraft = () => {
    const name = draft.name.trim();
    const command = draft.command.trim();
    const timeoutMs = Number(draft.timeoutMs);
    if (!name || !command) {
      toast.error("Hook name and command are required");
      return;
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      toast.error("Hook timeout must be a positive integer");
      return;
    }

    upsertHook.mutate({
      ...(draft.id ? { id: draft.id } : {}),
      name,
      event: draft.event,
      enabled: draft.enabled,
      policyPreset: draft.policyPreset,
      command,
      args: parseArgsText(draft.argsText),
      timeoutMs,
    });
  };

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy}
          onClick={() => void hooksQuery.refetch()}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={cn("mr-2 h-4 w-4", hooksQuery.isFetching ? "animate-spin" : "")}
          />
          Refresh
        </Button>
      }
      description="Project hook descriptors and lifecycle dispatch policy."
      icon={Workflow}
      title="Hooks"
    >
      <div className="grid gap-4">
        <div className="grid gap-3 rounded-md border bg-muted/20 p-3 lg:grid-cols-[1fr_240px]">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="hook-name">Name</Label>
              <Input
                id="hook-name"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                value={draft.name}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="hook-event">Event</Label>
              <Select
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, event: value }))
                }
                value={draft.event}
              >
                <SelectTrigger id="hook-event">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOOK_EVENT_OPTIONS.map((event) => (
                    <SelectItem key={event} value={event}>
                      {event}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="hook-command">Command</Label>
              <Input
                id="hook-command"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    command: event.target.value,
                  }))
                }
                value={draft.command}
              />
            </div>
            <div className="grid grid-cols-[1fr_96px] gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="hook-policy">Policy</Label>
                <Select
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      policyPreset: value as HookPolicyPreset,
                    }))
                  }
                  value={draft.policyPreset}
                >
                  <SelectTrigger id="hook-policy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOOK_POLICY_PRESETS.map((preset) => (
                      <SelectItem key={preset} value={preset}>
                        {preset}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="hook-timeout">Timeout</Label>
                <Input
                  id="hook-timeout"
                  inputMode="numeric"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      timeoutMs: event.target.value,
                    }))
                  }
                  value={draft.timeoutMs}
                />
              </div>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="hook-args">Args</Label>
              <Textarea
                className="min-h-20 font-mono text-xs"
                id="hook-args"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    argsText: event.target.value,
                  }))
                }
                value={draft.argsText}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col justify-between gap-3 border-t pt-3 lg:border-t-0 lg:border-l lg:pl-3 lg:pt-0">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-sm">Enabled</span>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(enabled) =>
                    setDraft((current) => ({ ...current, enabled }))
                  }
                  size="sm"
                />
              </div>
              {draft.id ? (
                <Badge className="w-fit" variant="secondary">
                  editing {draft.id}
                </Badge>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={upsertHook.isPending}
                onClick={saveDraft}
                size="sm"
              >
                <Save className="mr-2 h-4 w-4" />
                Save
              </Button>
              <Button
                disabled={upsertHook.isPending}
                onClick={() => setDraft(EMPTY_DRAFT)}
                size="sm"
                variant="outline"
              >
                Clear
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
          <StatBadge label="total" value={hooksQuery.data?.totalCount ?? 0} />
          <StatBadge
            label="enabled"
            value={hooksQuery.data?.enabledCount ?? 0}
          />
          <StatBadge label="ready" value={hooksQuery.data?.readyCount ?? 0} />
          <div className="flex items-center justify-between gap-3 sm:col-span-2">
            <div className="min-w-0">
              <div className="font-medium text-sm">Lifecycle</div>
              <div className="truncate text-muted-foreground text-xs">
                {lifecyclePolicy?.disabledEvents.length
                  ? `${lifecyclePolicy.disabledEvents.length} disabled events`
                  : "all events active"}
              </div>
            </div>
            <Switch
              checked={lifecyclePolicy?.enabled ?? true}
              disabled={updateLifecyclePolicy.isPending}
              onCheckedChange={(enabled) =>
                updateLifecyclePolicy.mutate({ enabled })
              }
              size="sm"
            />
          </div>
          <Select
            disabled={updateLifecyclePolicy.isPending}
            onValueChange={(failureMode) =>
              updateLifecyclePolicy.mutate({
                failureMode: failureMode as HookFailureMode,
              })
            }
            value={lifecyclePolicy?.failureMode ?? "continue"}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="continue">continue</SelectItem>
              <SelectItem value="stop-on-failure">stop-on-failure</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {hooksQuery.isLoading ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            Loading hooks...
          </div>
        ) : null}

        {!hooksQuery.isLoading && hooks.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            No hooks configured.
          </div>
        ) : null}

        {hooks.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {hooks.map((hook) => (
              <HookRow
                disabled={toggleHook.isPending}
                hook={hook}
                key={hook.id}
                onEdit={() => setDraft(toDraft(hook))}
                onToggle={(enabled) =>
                  toggleHook.mutate({
                    id: hook.id,
                    enabled,
                  })
                }
              />
            ))}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

function HookRow({
  disabled,
  hook,
  onEdit,
  onToggle,
}: {
  disabled?: boolean;
  hook: Hook;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const blocked = hook.executionPolicy.status === "blocked";
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-sm">{hook.name}</h3>
            <Badge variant={hook.enabled ? "default" : "outline"}>
              {hook.enabled ? "enabled" : "off"}
            </Badge>
            <Badge variant="outline">{hook.event}</Badge>
          </div>
          <code className="mt-2 block truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">
            {hook.command}
            {hook.args.length > 0 ? ` ${hook.args.join(" ")}` : ""}
          </code>
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-label={`Edit ${hook.name}`}
            className="h-8 w-8"
            onClick={onEdit}
            size="icon"
            variant="ghost"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Switch
            checked={hook.enabled}
            disabled={disabled}
            onCheckedChange={onToggle}
            size="sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        <Badge variant={statusVariant(hook.trustStatus)}>
          {hook.trustStatus}
        </Badge>
        <Badge variant={blocked ? "destructive" : "secondary"}>
          sandbox {hook.executionPolicy.status}
        </Badge>
        <Badge variant={statusVariant(hook.scheduling.status)}>
          schedule {hook.scheduling.status}
        </Badge>
        {hook.lastRun ? (
          <Badge variant={statusVariant(hook.lastRun.status)}>
            last {hook.lastRun.status}
          </Badge>
        ) : null}
      </div>

      {blocked || hook.diagnostics.length > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-amber-700 text-xs dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2">
            {[...hook.executionPolicy.blockers, ...hook.diagnostics].join(" ")}
          </span>
        </div>
      ) : null}

      <div className="flex items-center gap-1 text-muted-foreground text-xs">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span className="truncate" title={hook.sourcePath}>
          {shortPath(hook.sourcePath)}
        </span>
      </div>
    </div>
  );
}

function StatBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-md border bg-background px-3 py-2">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-semibold text-lg">{value}</div>
    </div>
  );
}

function parseArgsText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function toDraft(hook: Hook): HookDraft {
  return {
    id: hook.id,
    name: hook.name,
    event: hook.event,
    command: hook.command,
    argsText: hook.args.join("\n"),
    timeoutMs: String(hook.timeoutMs),
    policyPreset: hook.policyPreset,
    enabled: hook.enabled,
  };
}

function statusVariant(
  value: string
): "default" | "secondary" | "destructive" | "outline" {
  if (
    value === "trusted" ||
    value === "ready" ||
    value === "success" ||
    value === "allowed"
  ) {
    return "default";
  }
  if (value === "blocked" || value === "failed" || value === "timeout") {
    return "destructive";
  }
  if (value === "changed" || value === "cooldown" || value === "parallel-limit") {
    return "secondary";
  }
  return "outline";
}

function shortPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length <= 4) {
    return normalized;
  }
  return `.../${parts.slice(-3).join("/")}`;
}
