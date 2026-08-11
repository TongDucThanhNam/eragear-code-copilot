// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import { Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import {
  AlertCircle,
  ArrowUpRight,
  Clock3,
  Gauge,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { formatQuotaReset } from "./provider-quota-utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type QuotaCycleResult = RouterOutput["quota"]["cycleUsage"];
type ProviderQuotaView = QuotaCycleResult["providers"][number];
type QuotaSnapshotView = ProviderQuotaView["quota"];
type QuotaWindowView = QuotaSnapshotView["windows"][number];
type QuotaCycleView = ProviderQuotaView["cycles"][number];
type QuotaStatus = QuotaSnapshotView["status"];

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
      description="Live limits plus locally observed tokens and API-equivalent value inside each quota cycle."
      icon={Gauge}
      title="Quota"
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-muted-foreground text-xs">
          <span>
            Token totals are local observations. Capacity estimates improve
            after quota moves across multiple refreshes.
          </span>
          <Link
            className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary"
            to="/settings/usage"
          >
            Compare providers
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
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-sm">
              {quota.displayName}
            </h3>
            <Badge variant={getStatusVariant(quota.status)}>
              {formatStatus(quota.status)}
            </Badge>
            {quota.authSource ? (
              <Badge variant="outline">
                {formatAuthSource(quota.authSource)}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-1 text-muted-foreground text-xs">
            <Clock3 className="h-3.5 w-3.5" />
            {formatDateTime(timestamp)}
          </div>
        </div>
        <Badge variant="secondary">{quota.providerId}</Badge>
      </div>

      {quota.error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-destructive text-xs">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">{quota.error.message}</span>
        </div>
      ) : null}

      {quota.windows.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2">
          {quota.windows.map((window) => {
            const cycle = provider.cycles.find(
              (candidate) => candidate.windowId === window.id
            );
            return (
              <QuotaWindowItem cycle={cycle} key={window.id} window={window} />
            );
          })}
        </div>
      ) : quota.status === "ready" ? (
        <div className="rounded-md border border-dashed p-3 text-muted-foreground text-xs">
          Provider returned no quota windows.
        </div>
      ) : null}
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
  const estimate = cycle?.estimate;
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/20 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="truncate font-medium text-sm">{window.label}</div>
          <div className="mt-0.5 text-muted-foreground text-[11px]">
            {cycle?.observed.partialCycle
              ? "Observed since first local snapshot"
              : "Current quota cycle"}
          </div>
        </div>
        <div className="shrink-0 font-semibold text-lg tabular-nums">
          {window.unlimited
            ? "∞"
            : percent === undefined
              ? "n/a"
              : `${formatNumber(percent)}%`}
        </div>
      </div>
      <Progress value={percent ?? 0} />
      <div className="flex flex-wrap justify-between gap-2 text-muted-foreground text-xs">
        <span>{formatWindowCounts(window)}</span>
        {window.resetAt ? (
          <span title={formatDateTime(window.resetAt)}>
            {formatQuotaReset(window.resetAt)}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 border-border/60 border-t pt-3">
        <QuotaMetric
          label="Local tokens"
          value={formatTokenCount(cycle?.observed.tokens.totalTokens ?? 0)}
        />
        <QuotaMetric
          label="Observed API cost"
          value={formatUsd(cycle?.observed.apiEquivalent.totalUsd ?? 0)}
        />
      </div>
      {cycle ? (
        <div className="text-muted-foreground text-[11px] tabular-nums">
          {formatTokenCount(cycle.observed.tokens.inputTokens)} input ·{" "}
          {formatTokenCount(cycle.observed.tokens.cacheInputTokens)} cached ·{" "}
          {formatTokenCount(cycle.observed.tokens.outputTokens)} output
        </div>
      ) : null}

      <div
        className="rounded-md border border-border/50 bg-background/60 px-3 py-2.5"
        title={estimate?.reasons.join("\n")}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-xs">Projected full cycle</span>
          <Badge variant={getConfidenceVariant(estimate?.confidence)}>
            {formatConfidence(estimate?.confidence)}
          </Badge>
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
          <p className="mt-1.5 text-muted-foreground text-xs">
            Refresh after more usage to estimate full-cycle API cost and tokens.
          </p>
        )}
      </div>
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
    return "ENV";
  }
  if (source === "credential") {
    return "Credential";
  }
  return "Local auth";
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
    return `${formatNumber(window.remaining)} / ${formatNumber(window.total)} left`;
  }
  if (window.unlimited) {
    return "Unlimited";
  }
  if (window.percentRemaining !== undefined) {
    return `${formatNumber(window.percentRemaining)}% left`;
  }
  if (window.used !== undefined && window.total !== undefined) {
    return `${formatNumber(window.used)} / ${formatNumber(window.total)} used`;
  }
  if (window.remaining !== undefined) {
    return `${formatNumber(window.remaining)} left`;
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
    return "Learning";
  }
  return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)}`;
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}
