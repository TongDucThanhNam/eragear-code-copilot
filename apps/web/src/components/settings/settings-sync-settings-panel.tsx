"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { CloudCog, RefreshCw, RotateCcw, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type SettingsSyncStatus = RouterOutput["settingsSync"]["getStatus"];

export function SettingsSyncSettingsPanel() {
  const utils = trpc.useUtils();
  const statusQuery = trpc.settingsSync.getStatus.useQuery(undefined, {
    staleTime: 30_000,
  });
  const updateConfig = trpc.settingsSync.updateConfig.useMutation({
    onSuccess: async () => {
      await utils.settingsSync.getStatus.invalidate();
      toast.success("Settings sync updated");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update settings sync");
    },
  });
  const markPromptHandled =
    trpc.settingsSync.markFirstRunPromptHandled.useMutation({
      onSuccess: async () => {
        await utils.settingsSync.getStatus.invalidate();
        toast.success("First-run prompt dismissed");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update first-run prompt");
      },
    });
  const syncNow = trpc.settingsSync.syncNow.useMutation({
    onSuccess: async (result) => {
      await utils.settingsSync.getStatus.invalidate();
      await utils.settings.get.invalidate();
      toast.success(formatSyncAction(result.action));
    },
    onError: (error) => {
      toast.error(error.message || "Settings sync failed");
    },
  });

  const status = statusQuery.data;
  const isBusy =
    statusQuery.isFetching ||
    updateConfig.isPending ||
    markPromptHandled.isPending ||
    syncNow.isPending;

  return (
    <SettingsSection
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={isBusy || !status?.state.enabled}
            onClick={() => syncNow.mutate({ strategy: "auto" })}
            size="sm"
            variant="outline"
          >
            <RefreshCw
              className={cn("mr-2 h-4 w-4", syncNow.isPending ? "animate-spin" : "")}
            />
            Sync
          </Button>
          <Button
            disabled={isBusy}
            onClick={() => void statusQuery.refetch()}
            size="sm"
            variant="outline"
          >
            <RotateCcw
              className={cn(
                "mr-2 h-4 w-4",
                statusQuery.isFetching ? "animate-spin" : ""
              )}
            />
            Refresh
          </Button>
        </div>
      }
      description="Settings snapshot sync with explicit conflict handling and first-run prompt state."
      icon={CloudCog}
      title="Settings Sync"
    >
      {statusQuery.isLoading ? (
        <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
          Loading settings sync...
        </div>
      ) : null}

      {status ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant={status.state.enabled ? "secondary" : "outline"}>
              {status.state.enabled ? "enabled" : "off"}
            </Badge>
            <Badge variant={status.remote.available ? "secondary" : "outline"}>
              {status.remote.available ? "remote snapshot" : "no remote"}
            </Badge>
            {status.state.pendingConflict ? (
              <Badge variant="destructive">conflict</Badge>
            ) : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <label
              className="flex items-center justify-between gap-4 rounded-md border bg-background p-3"
              htmlFor="settings-sync-enabled"
            >
              <span className="min-w-0">
                <span className="block font-medium text-sm">Sync enabled</span>
                <span className="block text-muted-foreground text-xs">
                  Manual sync uses the configured snapshot adapter.
                </span>
              </span>
              <Switch
                checked={status.state.enabled}
                disabled={isBusy}
                id="settings-sync-enabled"
                onCheckedChange={(enabled) => updateConfig.mutate({ enabled })}
              />
            </label>

            <label
              className="flex items-center justify-between gap-4 rounded-md border bg-background p-3"
              htmlFor="settings-sync-first-run"
            >
              <span className="min-w-0">
                <span className="block font-medium text-sm">
                  First-run prompt
                </span>
                <span className="block text-muted-foreground text-xs">
                  {status.state.firstRunPromptHandled
                    ? "Handled"
                    : "Pending"}
                </span>
              </span>
              <Switch
                checked={status.state.firstRunPromptHandled}
                disabled={isBusy}
                id="settings-sync-first-run"
                onCheckedChange={(firstRunPromptHandled) =>
                  updateConfig.mutate({ firstRunPromptHandled })
                }
              />
            </label>
          </div>

          {status.state.pendingConflict ? (
            <ConflictPanel
              disabled={isBusy}
              onPull={() => syncNow.mutate({ strategy: "pull" })}
              onPush={() => syncNow.mutate({ strategy: "push" })}
              status={status}
            />
          ) : null}

          <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-sm lg:grid-cols-2">
            <Metadata label="Local hash" value={shortHash(status.localSettingsHash)} />
            <Metadata
              label="Remote revision"
              value={status.remote.revision ?? "none"}
            />
            <Metadata
              label="Last sync"
              value={formatOptionalTimestamp(status.state.lastSyncAt)}
            />
            <Metadata
              label="Remote updated"
              value={formatOptionalTimestamp(status.remote.updatedAt)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={isBusy || !status.state.enabled}
              onClick={() => syncNow.mutate({ strategy: "push" })}
              size="sm"
              variant="outline"
            >
              <UploadCloud className="mr-2 h-4 w-4" />
              Push Local
            </Button>
            <Button
              disabled={isBusy || !status.remote.available}
              onClick={() => syncNow.mutate({ strategy: "pull" })}
              size="sm"
              variant="outline"
            >
              Pull Remote
            </Button>
            {!status.state.firstRunPromptHandled ? (
              <Button
                disabled={isBusy}
                onClick={() => markPromptHandled.mutate()}
                size="sm"
                variant="ghost"
              >
                Dismiss Prompt
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </SettingsSection>
  );
}

function ConflictPanel({
  disabled,
  onPull,
  onPush,
  status,
}: {
  disabled: boolean;
  onPull: () => void;
  onPush: () => void;
  status: SettingsSyncStatus;
}) {
  const conflict = status.state.pendingConflict;
  if (!conflict) {
    return null;
  }
  return (
    <div className="grid gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium text-destructive text-sm">
            Settings sync conflict
          </div>
          <div className="mt-1 text-muted-foreground text-xs">
            {conflict.reason === "first_sync_remote_exists"
              ? "Remote settings already exist for this account."
              : "Local and remote settings changed since the last sync."}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={disabled} onClick={onPush} size="sm" variant="outline">
            Use Local
          </Button>
          <Button disabled={disabled} onClick={onPull} size="sm" variant="outline">
            Use Remote
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">local {shortHash(conflict.localHash)}</Badge>
        <Badge variant="outline">remote {shortHash(conflict.remoteHash)}</Badge>
      </div>
    </div>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="truncate font-mono text-xs">{value}</div>
    </div>
  );
}

function formatSyncAction(action: string): string {
  if (action === "pushed") {
    return "Settings pushed";
  }
  if (action === "pulled") {
    return "Settings pulled";
  }
  if (action === "conflict") {
    return "Settings sync conflict detected";
  }
  return "Settings already in sync";
}

function shortHash(value: string): string {
  return value.slice(0, 12);
}

function formatOptionalTimestamp(value: number | null): string {
  if (!value) {
    return "never";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
