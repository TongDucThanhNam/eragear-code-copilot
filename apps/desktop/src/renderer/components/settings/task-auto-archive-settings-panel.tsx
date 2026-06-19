// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { ArchiveRestore, Play, RefreshCw, Save } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type TaskAutoArchiveStatus = RouterOutput["taskAutoArchive"]["getStatus"];

export function TaskAutoArchiveSettingsPanel() {
  const utils = trpc.useUtils();
  const [draftDays, setDraftDays] = React.useState("7");
  const statusQuery = trpc.taskAutoArchive.getStatus.useQuery(undefined, {
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (statusQuery.data?.settings.olderThanDays) {
      setDraftDays(String(statusQuery.data.settings.olderThanDays));
    }
  }, [statusQuery.data?.settings.olderThanDays]);

  const updateStatusCache = async (data: TaskAutoArchiveStatus) => {
    utils.taskAutoArchive.getStatus.setData(undefined, data);
  };

  const updateSettings = trpc.taskAutoArchive.updateSettings.useMutation({
    onSuccess: async (data) => {
      await updateStatusCache(data);
      toast.success("Task auto-archive settings updated");
    },
    onError: (error) =>
      toast.error(error.message || "Failed to update task auto-archive"),
  });

  const runNow = trpc.taskAutoArchive.runNow.useMutation({
    onSuccess: async () => {
      await utils.taskAutoArchive.getStatus.invalidate();
      await utils.getSessions.invalidate();
      await utils.getSessionsPage.invalidate();
      toast.success("Task auto-archive run finished");
    },
    onError: (error) =>
      toast.error(error.message || "Failed to run task auto-archive"),
  });

  const status = statusQuery.data;
  const isBusy =
    statusQuery.isFetching || updateSettings.isPending || runNow.isPending;

  const saveDays = () => {
    const olderThanDays = Number(draftDays);
    if (!Number.isInteger(olderThanDays) || olderThanDays <= 0) {
      toast.error("Archive threshold must be a positive whole number");
      return;
    }
    updateSettings.mutate({ olderThanDays });
  };

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy}
          onClick={() => void statusQuery.refetch()}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={cn(
              "mr-2 h-4 w-4",
              statusQuery.isFetching ? "animate-spin" : ""
            )}
          />
          Refresh
        </Button>
      }
      description="Automatically archive old stopped tasks while leaving pinned, active, and recent work visible."
      icon={ArchiveRestore}
      title="Task Auto-Archive"
    >
      {status ? (
        <div className="grid gap-4">
          <label
            className="flex items-center justify-between gap-4 rounded-md border bg-background p-3"
            htmlFor="task-auto-archive-enabled"
          >
            <span className="min-w-0">
              <span className="block font-medium text-sm">Auto-archive</span>
              <span className="block text-muted-foreground text-xs">
                Stopped, unpinned tasks older than the configured threshold are
                archived.
              </span>
            </span>
            <Switch
              checked={status.settings.enabled}
              disabled={isBusy}
              id="task-auto-archive-enabled"
              onCheckedChange={(enabled) => updateSettings.mutate({ enabled })}
            />
          </label>

          <div className="grid gap-3 rounded-md border bg-background p-3 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-1.5">
              <Label htmlFor="task-auto-archive-days">
                Archive stopped tasks older than
              </Label>
              <Input
                className="max-w-40"
                id="task-auto-archive-days"
                min={1}
                onChange={(event) => setDraftDays(event.target.value)}
                type="number"
                value={draftDays}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button disabled={isBusy} onClick={saveDays} variant="outline">
                <Save className="mr-2 h-4 w-4" />
                Save
              </Button>
              <Button
                disabled={isBusy || !status.settings.enabled}
                onClick={() => runNow.mutate({ dryRun: true })}
                variant="outline"
              >
                Dry run
              </Button>
              <Button
                disabled={isBusy || !status.settings.enabled}
                onClick={() => runNow.mutate({ dryRun: false })}
              >
                <Play className="mr-2 h-4 w-4" />
                Run
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Policy"
              value={status.settings.enabled ? "enabled" : "disabled"}
            />
            <Metric
              label="Threshold"
              value={`${status.settings.olderThanDays}d`}
            />
            <Metric
              label="Last archived"
              value={status.lastRun ? String(status.lastRun.archived) : "n/a"}
            />
            <Metric
              label="Last eligible"
              value={status.lastRun ? String(status.lastRun.eligible) : "n/a"}
            />
          </div>

          {status.lastRun ? (
            <div className="grid gap-2 rounded-md border bg-background p-3">
              <div className="font-medium text-sm">Last run</div>
              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <Info
                  label="Checked"
                  value={formatDateTime(status.lastRun.checkedAt)}
                />
                <Info
                  label="Inspected"
                  value={String(status.lastRun.inspected)}
                />
                <Info
                  label="Pinned"
                  value={String(status.lastRun.skippedPinned)}
                />
                <Info
                  label="Running"
                  value={String(status.lastRun.skippedRunning)}
                />
                <Info
                  label="Recent"
                  value={String(status.lastRun.skippedRecent)}
                />
                <Info
                  label="Already archived"
                  value={String(status.lastRun.skippedArchived)}
                />
                <Info label="Failed" value={String(status.lastRun.failed)} />
                <Info
                  label="Dry run"
                  value={status.lastRun.dryRun ? "yes" : "no"}
                />
              </div>
              {status.lastRun.diagnostics.slice(0, 3).map((diagnostic) => (
                <div
                  className="rounded-md border bg-muted/20 p-2 text-muted-foreground text-xs"
                  key={diagnostic}
                >
                  {diagnostic}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
              Auto-archive has not run yet.
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
          Loading task auto-archive settings...
        </div>
      )}
    </SettingsSection>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 truncate font-semibold text-xl">{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
