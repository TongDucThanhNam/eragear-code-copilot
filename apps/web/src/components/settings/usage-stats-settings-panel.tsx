"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { BarChart3, Clock3, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type UsageSummary = RouterOutput["usageStats"]["getSummary"];
type UsageRecord = UsageSummary["recent"][number];

export function UsageStatsSettingsPanel() {
  const utils = trpc.useUtils();
  const summaryQuery = trpc.usageStats.getSummary.useQuery(
    { range: "7d" },
    {
      staleTime: 30_000,
    }
  );
  const updateTelemetry = trpc.usageStats.updateTelemetry.useMutation({
    onSuccess: async () => {
      await utils.usageStats.getSummary.invalidate();
      toast.success("Telemetry setting updated");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update telemetry setting");
    },
  });

  const summary = summaryQuery.data;
  const isBusy = summaryQuery.isFetching || updateTelemetry.isPending;

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy}
          onClick={() => void summaryQuery.refetch()}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={cn(
              "mr-2 h-4 w-4",
              summaryQuery.isFetching ? "animate-spin" : ""
            )}
          />
          Refresh
        </Button>
      }
      description="Local usage counters with explicit telemetry opt-in state."
      icon={BarChart3}
      title="Usage Statistics"
    >
      <div className="grid gap-4">
        <label
          className="flex items-center justify-between gap-4 rounded-md border bg-background p-3"
          htmlFor="usage-telemetry-enabled"
        >
          <span className="min-w-0">
            <span className="block font-medium text-sm">
              Telemetry opt-in
            </span>
            <span className="block text-muted-foreground text-xs">
              Local usage statistics are retained on this device; external
              telemetry remains off unless enabled here.
            </span>
          </span>
          <Switch
            checked={summary?.telemetry.enabled ?? false}
            disabled={isBusy}
            id="usage-telemetry-enabled"
            onCheckedChange={(enabled) =>
              updateTelemetry.mutate({ enabled })
            }
          />
        </label>

        {summary ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Prompts" value={summary.totals.promptCount} />
              <Metric label="Turns" value={summary.totals.turnCount} />
              <Metric
                label="Quota refreshes"
                value={summary.totals.quotaRefreshCount}
              />
              <Metric label="Active chats" value={summary.totals.activeChats} />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <UsageBucketList
                emptyText="No usage recorded in this range."
                title="Daily activity"
                buckets={summary.byDay}
              />
              <UsageBucketList
                emptyText="No project activity recorded."
                title="Projects"
                buckets={summary.byProject}
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-sm">Recent events</div>
                <div className="flex items-center gap-1 text-muted-foreground text-xs">
                  <Clock3 className="h-3.5 w-3.5" />
                  {formatDateTime(summary.checkedAt)}
                </div>
              </div>
              {summary.recent.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
                  No usage events recorded yet.
                </div>
              ) : (
                <div className="grid gap-2">
                  {summary.recent.map((record) => (
                    <UsageRecordRow key={record.id} record={record} />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            Loading usage statistics...
          </div>
        )}
      </div>
    </SettingsSection>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 font-semibold text-2xl tabular-nums">
        {formatNumber(value)}
      </div>
    </div>
  );
}

function UsageBucketList({
  buckets,
  emptyText,
  title,
}: {
  buckets: UsageSummary["byDay"];
  emptyText: string;
  title: string;
}) {
  return (
    <div className="grid gap-2 rounded-md border bg-background p-3">
      <div className="font-medium text-sm">{title}</div>
      {buckets.length === 0 ? (
        <div className="text-muted-foreground text-xs">{emptyText}</div>
      ) : (
        buckets.slice(0, 8).map((bucket) => (
          <div
            className="flex items-center justify-between gap-3 text-sm"
            key={bucket.key}
          >
            <span className="min-w-0 truncate">{bucket.key}</span>
            <span className="shrink-0 text-muted-foreground text-xs">
              {bucket.promptCount} prompts / {bucket.turnCount} turns
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function UsageRecordRow({ record }: { record: UsageRecord }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3 text-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{formatKind(record.kind)}</Badge>
          {record.providerDisplayName ? (
            <span className="text-muted-foreground text-xs">
              {record.providerDisplayName}
            </span>
          ) : null}
          {record.projectId ? (
            <span className="text-muted-foreground text-xs">
              {record.projectId}
            </span>
          ) : null}
        </div>
        <div className="mt-1 truncate text-muted-foreground text-xs">
          {record.chatId ?? record.providerId ?? record.projectRoot ?? "usage"}
        </div>
      </div>
      <span className="text-muted-foreground text-xs">
        {formatDateTime(record.createdAt)}
      </span>
    </div>
  );
}

function formatKind(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined).format(value);
}
