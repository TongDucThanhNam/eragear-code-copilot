// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import { Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Clock3,
  Gauge,
  Info,
  RefreshCw,
  TimerReset,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  formatQuotaReset,
  formatQuotaWindowScope,
  formatQuotaWindowTitle,
  getQuotaEstimateEmptyState,
  getQuotaHealthLabel,
  getQuotaWindowHealth,
  isToolCallQuotaWindow,
  type QuotaWindowHealth,
} from "./provider-quota-utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type QuotaCycleResult = RouterOutput["quota"]["cycleUsage"];
type ProviderQuotaView = QuotaCycleResult["providers"][number];
type QuotaSnapshotView = ProviderQuotaView["quota"];
type QuotaWindowView = QuotaSnapshotView["windows"][number];
type QuotaCycleView = ProviderQuotaView["cycles"][number];
type QuotaStatus = QuotaSnapshotView["status"];

const HEALTH_BADGE_CLASSES: Record<QuotaWindowHealth, string> = {
  available: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  exhausted: "border-destructive/40 bg-destructive/10 text-destructive",
  low: "border-amber-500/35 bg-amber-500/10 text-amber-500",
  unlimited: "border-sky-500/30 bg-sky-500/10 text-sky-500",
  unknown: "border-border bg-muted/40 text-muted-foreground",
};

const HEALTH_CARD_CLASSES: Record<QuotaWindowHealth, string> = {
  available: "border-border/70 bg-muted/10",
  exhausted: "border-destructive/35 bg-destructive/[0.035]",
  low: "border-amber-500/30 bg-amber-500/[0.035]",
  unlimited: "border-sky-500/25 bg-sky-500/[0.03]",
  unknown: "border-border/70 bg-muted/10",
};

const HEALTH_PROGRESS_CLASSES: Record<QuotaWindowHealth, string> = {
  available:
    "bg-emerald-500/15 [&_[data-slot=progress-indicator]]:bg-emerald-500",
  exhausted:
    "bg-destructive/15 [&_[data-slot=progress-indicator]]:bg-destructive",
  low: "bg-amber-500/15 [&_[data-slot=progress-indicator]]:bg-amber-500",
  unlimited: "bg-sky-500/15 [&_[data-slot=progress-indicator]]:bg-sky-500",
  unknown: "bg-muted [&_[data-slot=progress-indicator]]:bg-muted-foreground",
};

export function ProviderQuotaPanel() {
  const utils = trpc.useUtils();
  const quotaQuery = trpc.quota.cycleUsage.useQuery(
    { includeUnavailable: true },
    {
      gcTime: 15 * 60 * 1000,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    }
  );
  const refreshQuota = trpc.quota.refresh.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.quota.list.invalidate(),
        utils.quota.cycleUsage.invalidate(),
      ]);
      toast.success("Provider quota refreshed");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to refresh provider quota");
    },
  });

  const providers = quotaQuery.data?.providers ?? [];
  const isBusy = quotaQuery.isLoading || refreshQuota.isPending;
  const readyProviders = providers.filter(
    (provider) => provider.quota.status === "ready"
  ).length;
  const windows = providers.flatMap((provider) => provider.quota.windows);
  const exhaustedWindows = windows.filter(
    (window) => getQuotaWindowHealth(window) === "exhausted"
  ).length;

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy}
          onClick={() =>
            refreshQuota.mutate({
              includeUnavailable: true,
              force: true,
            })
          }
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={cn("mr-2 h-4 w-4", isBusy ? "animate-spin" : "")}
          />
          Refresh
        </Button>
      }
      description="See what is available now, when each limit resets, and how much local usage it represents."
      icon={Gauge}
      title="Quota"
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/60 bg-muted/15 px-4 py-3.5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 rounded-full bg-primary/10 p-1.5 text-primary">
              <Info className="size-3.5" />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-sm">
                {readyProviders} of {providers.length} providers connected
              </div>
              <p className="mt-0.5 text-muted-foreground text-xs">
                {windows.length} live limits
                {exhaustedWindows > 0
                  ? ` · ${exhaustedWindows} exhausted`
                  : " · none exhausted"}
                . Token and cost values are observed only from local logs.
              </p>
            </div>
          </div>
          <Link
            className="inline-flex shrink-0 items-center gap-1.5 font-medium text-sm hover:text-primary"
            to="/settings/usage"
          >
            Compare usage
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>

        {quotaQuery.isLoading ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            Loading provider quota...
          </div>
        ) : null}

        {!quotaQuery.isLoading && providers.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            No quota providers detected.
          </div>
        ) : null}

        {quotaQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
            Failed to correlate quota and usage: {quotaQuery.error.message}
          </div>
        ) : null}

        {providers.map((provider) => (
          <ProviderQuotaItem
            key={provider.quota.providerId}
            provider={provider}
          />
        ))}
      </div>
    </SettingsSection>
  );
}

function ProviderQuotaItem({ provider }: { provider: ProviderQuotaView }) {
  const quota = provider.quota;
  const timestamp = quota.fetchedAt ?? quota.checkedAt;
  const summary = getProviderWindowSummary(quota.windows);
  return (
    <div className="overflow-hidden rounded-xl border bg-background/70">
      <div className="flex flex-wrap items-start justify-between gap-4 border-border/60 border-b bg-muted/10 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-base">
              {quota.displayName}
            </h3>
            <Badge variant={getStatusVariant(quota.status)}>
              {formatStatus(quota.status)}
            </Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5" />
              Updated {formatDateTime(timestamp)}
            </span>
            {quota.authSource ? (
              <span>· {formatAuthSource(quota.authSource)}</span>
            ) : null}
          </div>
        </div>
        {summary ? (
          <Badge
            className={cn("font-normal", HEALTH_BADGE_CLASSES[summary.health])}
            variant="outline"
          >
            {summary.label}
          </Badge>
        ) : null}
      </div>

      <div className="p-4">
        {quota.error ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-xs">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">{quota.error.message}</span>
          </div>
        ) : null}

        {quota.windows.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {quota.windows.map((window) => {
              const cycle = provider.cycles.find(
                (candidate) => candidate.windowId === window.id
              );
              return (
                <QuotaWindowItem
                  cycle={cycle}
                  key={window.id}
                  window={window}
                />
              );
            })}
          </div>
        ) : quota.status === "ready" ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-xs">
            This provider did not return any quota limits.
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-xs">
            Configure this provider to see its live limits.
          </div>
        )}
      </div>
    </div>
  );
}

function QuotaWindowItem({
  cycle,
  window,
}: {
  cycle?: QuotaCycleView;
  window: QuotaWindowView;
}) {
  const percent = window.unlimited ? 100 : window.percentRemaining;
  const health = getQuotaWindowHealth(window);
  const estimate = cycle?.estimate;
  const estimateEmptyState = getQuotaEstimateEmptyState(estimate);
  const scope = formatQuotaWindowScope(window);
  const tracksToolCalls = isToolCallQuotaWindow(window);
  return (
    <div className={cn("rounded-xl border p-4", HEALTH_CARD_CLASSES[health])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-sm">
            {formatQuotaWindowTitle(window)}
          </div>
          <div className="mt-1 text-muted-foreground text-xs">
            {[
              scope,
              tracksToolCalls
                ? "Provider-reported call usage"
                : getCycleObservationLabel(cycle),
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <Badge
          className={cn("shrink-0 font-normal", HEALTH_BADGE_CLASSES[health])}
          variant="outline"
        >
          {getQuotaHealthLabel(health)}
        </Badge>
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-semibold text-3xl tabular-nums tracking-tight">
            {window.unlimited
              ? "∞"
              : percent === undefined
                ? "n/a"
                : `${formatNumber(percent)}%`}
          </div>
          <div className="mt-0.5 text-muted-foreground text-xs">
            {window.unlimited ? "No enforced limit" : "remaining"}
          </div>
        </div>
        <div className="text-right text-muted-foreground text-xs">
          {window.resetAt ? (
            <span
              className="inline-flex items-center gap-1.5"
              title={formatDateTime(window.resetAt)}
            >
              <TimerReset className="size-3.5" />
              {formatQuotaReset(window.resetAt)}
            </span>
          ) : (
            "Reset schedule unavailable"
          )}
        </div>
      </div>

      <Progress
        className={cn(
          "mt-3 h-1.5 rounded-full",
          HEALTH_PROGRESS_CLASSES[health]
        )}
        value={percent ?? 0}
      />
      {tracksToolCalls ? (
        <McpUsageBreakdown window={window} />
      ) : (
        <>
          <div className="mt-2 text-muted-foreground text-xs">
            <span>{formatWindowCounts(window)}</span>
          </div>

          <div className="mt-4 border-border/60 border-y py-3">
            <div className="mb-2 flex items-center gap-1.5 font-medium text-xs">
              <Activity className="size-3.5 text-muted-foreground" />
              Observed locally
            </div>
            <div className="grid grid-cols-2 gap-3">
              <QuotaMetric
                label="Tokens"
                value={formatTokenCount(
                  cycle?.observed.tokens.totalTokens ?? 0
                )}
              />
              <QuotaMetric
                label="API-equivalent value"
                value={formatUsd(cycle?.observed.apiEquivalent.totalUsd ?? 0)}
              />
            </div>
            {cycle ? (
              <div className="mt-2 text-muted-foreground text-[11px] tabular-nums">
                Input {formatTokenCount(cycle.observed.tokens.inputTokens)}
                {" · Cached "}
                {formatTokenCount(cycle.observed.tokens.cacheInputTokens)}
                {" · Output "}
                {formatTokenCount(cycle.observed.tokens.outputTokens)}
              </div>
            ) : null}
          </div>

          <div className="pt-3" title={estimate?.reasons.join("\n")}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-xs">Full-cycle capacity</span>
              {estimate?.projectedTokenCapacity !== undefined ? (
                <Badge variant={getConfidenceVariant(estimate.confidence)}>
                  {formatConfidence(estimate.confidence)}
                </Badge>
              ) : null}
            </div>
            {estimate?.projectedTokenCapacity !== undefined ? (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <QuotaMetric
                  label="API-priced cost"
                  value={
                    estimate.projectedApiEquivalent === undefined
                      ? "Unavailable"
                      : `~${formatUsd(estimate.projectedApiEquivalent)}`
                  }
                />
                <QuotaMetric
                  label="Token capacity"
                  value={`~${formatTokenCount(estimate.projectedTokenCapacity)}`}
                />
              </div>
            ) : (
              <div className="mt-2 flex items-start gap-2">
                <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="font-medium text-xs">
                    {estimateEmptyState.label}
                  </div>
                  <p className="mt-0.5 text-muted-foreground text-xs">
                    {estimateEmptyState.detail}
                  </p>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function McpUsageBreakdown({ window }: { window: QuotaWindowView }) {
  const hasTypedCounters = window.usageKind === "tool_calls";
  const used = hasTypedCounters ? window.used : undefined;
  const remaining = hasTypedCounters ? window.remaining : undefined;
  const total = hasTypedCounters ? window.total : undefined;

  return (
    <div className="mt-4 border-border/60 border-t pt-3">
      <div className="mb-2 flex items-center gap-1.5 font-medium text-xs">
        <Activity className="size-3.5 text-muted-foreground" />
        MCP calls
      </div>
      <div className="grid grid-cols-3 gap-3">
        <QuotaMetric label="Used" value={formatQuotaCount(used)} />
        <QuotaMetric label="Remaining" value={formatQuotaCount(remaining)} />
        <QuotaMetric label="Allowance" value={formatQuotaCount(total)} />
      </div>
      <p className="mt-2 text-muted-foreground text-[11px]">
        {hasTypedCounters
          ? "Reported directly by the provider. Model tokens and API cost do not apply to this limit."
          : "Detailed MCP call counters are unavailable in this provider snapshot."}
      </p>
    </div>
  );
}

function QuotaMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-muted-foreground text-[11px]">{label}</div>
      <div className="mt-0.5 truncate font-medium text-sm tabular-nums">
        {value}
      </div>
    </div>
  );
}

function getProviderWindowSummary(windows: QuotaWindowView[]): {
  health: QuotaWindowHealth;
  label: string;
} | null {
  if (windows.length === 0) {
    return null;
  }
  const health = windows.map(getQuotaWindowHealth);
  const exhausted = health.filter((value) => value === "exhausted").length;
  if (exhausted > 0) {
    return {
      health: "exhausted",
      label: `${exhausted} ${exhausted === 1 ? "limit" : "limits"} exhausted`,
    };
  }
  const low = health.filter((value) => value === "low").length;
  if (low > 0) {
    return {
      health: "low",
      label: `${low} ${low === 1 ? "limit is" : "limits are"} running low`,
    };
  }
  if (health.every((value) => value === "unlimited")) {
    return { health: "unlimited", label: "Unlimited" };
  }
  if (health.some((value) => value === "unknown")) {
    return { health: "unknown", label: "Some limits unknown" };
  }
  return { health: "available", label: "All limits available" };
}

function getCycleObservationLabel(cycle: QuotaCycleView | undefined): string {
  if (!cycle) {
    return "Usage observation unavailable";
  }
  return cycle.observed.partialCycle
    ? "Partial local observation"
    : "Current cycle";
}

function getStatusVariant(status: QuotaStatus) {
  if (status === "ready") {
    return "default";
  }
  if (status === "error") {
    return "destructive";
  }
  if (status === "not_configured") {
    return "outline";
  }
  return "secondary";
}

function formatStatus(status: QuotaStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "not_configured":
      return "Not configured";
    case "unavailable":
      return "Unavailable";
    case "error":
      return "Error";
  }
}

function formatAuthSource(source: "env" | "local_auth" | "credential"): string {
  if (source === "env") {
    return "Environment credential";
  }
  if (source === "credential") {
    return "Saved credential";
  }
  return "Local authentication";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatWindowCounts(window: QuotaWindowView): string {
  if (window.remaining !== undefined && window.total !== undefined) {
    return `${formatNumber(window.remaining)} of ${formatNumber(window.total)} remaining`;
  }
  if (window.unlimited) {
    return "No enforced quota";
  }
  if (window.percentRemaining !== undefined) {
    return "Provider-reported remaining quota";
  }
  if (window.used !== undefined && window.total !== undefined) {
    return `${formatNumber(window.used)} of ${formatNumber(window.total)} used`;
  }
  if (window.remaining !== undefined) {
    return `${formatNumber(window.remaining)} remaining`;
  }
  if (window.used !== undefined) {
    return `${formatNumber(window.used)} used`;
  }
  return "Quota window";
}

function getConfidenceVariant(
  confidence: QuotaCycleView["estimate"]["confidence"] | undefined
) {
  if (confidence === "high") {
    return "default";
  }
  if (confidence === "medium" || confidence === "low") {
    return "secondary";
  }
  return "outline";
}

function formatConfidence(
  confidence: QuotaCycleView["estimate"]["confidence"] | undefined
): string {
  if (!confidence || confidence === "unavailable") {
    return "Estimate unavailable";
  }
  return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence`;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000_000) {
    return `${trimNumber(value / 1_000_000_000)}B`;
  }
  if (value >= 1_000_000) {
    return `${trimNumber(value / 1_000_000)}M`;
  }
  if (value >= 1000) {
    return `${trimNumber(value / 1000)}K`;
  }
  return formatNumber(Math.round(value));
}

function formatUsd(value: number): string {
  if (!(Number.isFinite(value) && value > 0)) {
    return "$0.00";
  }
  return new Intl.NumberFormat(undefined, {
    currency: "USD",
    maximumFractionDigits: value < 100 ? 2 : 0,
    minimumFractionDigits: value < 100 ? 2 : 0,
    style: "currency",
  }).format(value);
}

function trimNumber(value: number): string {
  return value >= 10
    ? value.toFixed(1).replace(/\.0$/, "")
    : value.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

function formatQuotaCount(value: number | undefined): string {
  return value === undefined ? "Not reported" : formatNumber(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}
