// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import { Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Gauge,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { Switch } from "@/components/ui/switch";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { isToolCallQuotaWindow } from "./provider-quota-utils";
import {
  buildProviderCentricUsage,
  type ProviderCentricUsageView,
  type ProviderDailyUsageView,
  type ProviderModelUsageView,
  type ProviderUsageView,
} from "./usage-provider-view";

type RouterOutput = inferRouterOutputs<AppRouter>;
type UsageSummary = RouterOutput["usageStats"]["getSummary"];
type CliUsage = NonNullable<UsageSummary["cliUsage"]>;
type CliDaily = CliUsage["daily"][number];
type UsageRange = UsageSummary["range"];
type QuotaCycleResult = RouterOutput["quota"]["cycleUsage"];
type QuotaCycleProvider = QuotaCycleResult["providers"][number];
type QuotaCycle = QuotaCycleProvider["cycles"][number];
type ChartMetric = "cost" | "tokens";
type BreakdownMode = "model" | "day";

interface DailyChartDatum {
  date: string;
  totalCost: number;
  totalTokens: number;
  [key: string]: number | string;
}

const RANGE_OPTIONS: Array<{ value: UsageRange; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#e8794f",
  cursor: "#38bdf8",
  deepseek: "#22c55e",
  google: "#a78bfa",
  "minimax-coding-plan": "#2dd4bf",
  moonshotai: "#f59e0b",
  multiple: "#94a3b8",
  "offpeak-idle-plan": "#c084fc",
  openai: "#a3a3a3",
  unattributed: "#64748b",
  xai: "#f8fafc",
  zai: "#818cf8",
};

const FALLBACK_PROVIDER_COLORS = [
  "#94a3b8",
  "#f97316",
  "#22c55e",
  "#0ea5e9",
  "#8b5cf6",
  "#f43f5e",
];
const USAGE_QUERY_STALE_MS = 5 * 60 * 1000;
const USAGE_QUERY_GC_MS = 15 * 60 * 1000;

export function UsageStatsSettingsPanel() {
  const utils = trpc.useUtils();
  const [range, setRange] = React.useState<UsageRange>("30d");
  const summaryQuery = trpc.usageStats.getSummary.useQuery(
    { range, includeCliUsage: true },
    {
      gcTime: USAGE_QUERY_GC_MS,
      placeholderData: (previousData) => previousData,
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: USAGE_QUERY_STALE_MS,
    }
  );
  const quotaCycleQuery = trpc.quota.cycleUsage.useQuery(undefined, {
    enabled: summaryQuery.isSuccess,
    gcTime: USAGE_QUERY_GC_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: USAGE_QUERY_STALE_MS,
  });
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
  const cliUsage = summary?.cliUsage;
  const providerUsage = React.useMemo(
    () => (cliUsage ? buildProviderCentricUsage(cliUsage) : undefined),
    [cliUsage]
  );
  const isBusy =
    summaryQuery.isFetching ||
    quotaCycleQuery.isFetching ||
    updateTelemetry.isPending;
  const [isSlowLoading, setIsSlowLoading] = React.useState(false);

  React.useEffect(() => {
    if (!summaryQuery.isLoading) {
      setIsSlowLoading(false);
      return;
    }

    setIsSlowLoading(false);
    const timeout = window.setTimeout(() => setIsSlowLoading(true), 8000);
    return () => window.clearTimeout(timeout);
  }, [summaryQuery.isLoading]);

  return (
    <section className="min-w-0">
      <UsageHeader
        checkedAt={cliUsage?.checkedAt}
        daily={cliUsage?.daily ?? []}
        disabled={isBusy}
        isRefreshing={summaryQuery.isFetching || quotaCycleQuery.isFetching}
        onRangeChange={setRange}
        onRefresh={() => {
          void Promise.all([summaryQuery.refetch(), quotaCycleQuery.refetch()]);
        }}
        range={range}
      />

      {summaryQuery.isLoading ? (
        <UsageLoadingState isSlow={isSlowLoading} />
      ) : summaryQuery.isError ? (
        <EmptyState
          text={`Failed to load usage statistics: ${summaryQuery.error.message}`}
        />
      ) : summary && cliUsage && providerUsage ? (
        <div className="grid gap-8">
          <UsageOverview providerUsage={providerUsage} usage={cliUsage} />
          <UsageMetricStrip usage={cliUsage} />
          <QuotaEfficiencyComparison
            data={quotaCycleQuery.data}
            error={quotaCycleQuery.error?.message}
            isLoading={quotaCycleQuery.isLoading}
          />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(260px,0.55fr)]">
            <BreakdownTable providerUsage={providerUsage} usage={cliUsage} />
            <CostQuality providerUsage={providerUsage} usage={cliUsage} />
          </div>

          {cliUsage.warnings.length > 0 ? (
            <UsageNotice>{cliUsage.warnings.slice(0, 3).join(" ")}</UsageNotice>
          ) : null}

          {cliUsage.pricing.unpricedTokens > 0 ? (
            <UsageNotice>
              {formatTokenCount(cliUsage.pricing.unpricedTokens)} tokens do not
              have matching API pricing in the bundled models.dev snapshot and
              are excluded from estimated cost.
            </UsageNotice>
          ) : null}

          <TelemetryOptIn
            checked={summary.telemetry.enabled}
            disabled={isBusy}
            onChange={(enabled) => updateTelemetry.mutate({ enabled })}
          />
        </div>
      ) : summary ? (
        <LegacyUsageFallback
          disabled={isBusy}
          onTelemetryChange={(enabled) => updateTelemetry.mutate({ enabled })}
          summary={summary}
        />
      ) : (
        <EmptyState text="No usage statistics response." />
      )}
    </section>
  );
}

function UsageHeader({
  checkedAt,
  daily,
  disabled,
  isRefreshing,
  onRangeChange,
  onRefresh,
  range,
}: {
  checkedAt?: number;
  daily: CliDaily[];
  disabled: boolean;
  isRefreshing: boolean;
  onRangeChange: (range: UsageRange) => void;
  onRefresh: () => void;
  range: UsageRange;
}) {
  return (
    <header className="mb-10 flex flex-wrap items-start justify-between gap-5">
      <div className="min-w-0">
        <h1 className="font-semibold text-3xl tracking-[-0.03em]">Usage</h1>
        <p className="mt-1.5 text-muted-foreground text-sm">
          {formatUsagePeriod(daily, range)}
          {checkedAt ? (
            <span className="ml-2 hidden text-muted-foreground/55 sm:inline">
              · updated {formatRelativeTimestamp(checkedAt)}
            </span>
          ) : null}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-border/70 bg-muted/25 p-0.5">
          {RANGE_OPTIONS.map((option) => (
            <button
              aria-pressed={range === option.value}
              className={cn(
                "h-8 rounded-md px-3 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground",
                range === option.value &&
                  "bg-background text-foreground shadow-sm ring-1 ring-border/60"
              )}
              disabled={disabled}
              key={option.value}
              onClick={() => onRangeChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <Button
          aria-label="Refresh usage statistics"
          className="size-9 rounded-lg"
          disabled={disabled}
          onClick={onRefresh}
          size="icon"
          title="Refresh usage statistics"
          variant="outline"
        >
          <RefreshCw
            className={cn("size-4", isRefreshing ? "animate-spin" : "")}
          />
        </Button>
      </div>
    </header>
  );
}

function UsageOverview({
  providerUsage,
  usage,
}: {
  providerUsage: ProviderCentricUsageView;
  usage: CliUsage;
}) {
  const providers = providerUsage.providers;
  const overviewProviders = providers.slice(0, 4);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.55fr)] lg:items-start">
      <section className="min-w-0 pt-1">
        <div className="font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
          Estimated token cost
        </div>
        <div className="mt-2 font-semibold text-4xl tabular-nums tracking-[-0.04em] sm:text-5xl">
          {formatUsd(usage.cost.totalUsd, true)}
          <span className="ml-0.5 text-muted-foreground text-2xl">*</span>
        </div>
        <p className="mt-2 text-muted-foreground text-xs">
          * estimated at bundled public API rates
        </p>

        <div className="mt-7 grid gap-5">
          {providers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No provider usage in this range.
            </p>
          ) : (
            overviewProviders.map((provider, index) => {
              const share = getProviderShare(provider, usage);
              return (
                <div key={provider.providerId}>
                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ProviderMark
                        color={getProviderColor(provider.providerId, index)}
                      />
                      <span className="truncate font-medium">
                        {provider.providerDisplayName}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatUsd(provider.cost.totalUsd)}
                    </span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted/60">
                    <div
                      className="h-full rounded-full"
                      style={{
                        backgroundColor: getProviderColor(
                          provider.providerId,
                          index
                        ),
                        width: `${Math.max(1.5, share * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="mt-1.5 text-muted-foreground text-xs tabular-nums">
                    {formatPercent(share)} of usage · {provider.modelCount}{" "}
                    {provider.modelCount === 1 ? "model" : "models"}
                    {" · "}
                    {formatTokenCount(provider.totals.totalTokens)} tokens
                  </div>
                </div>
              );
            })
          )}
          {providers.length > overviewProviders.length ? (
            <p className="text-muted-foreground text-xs">
              +{providers.length - overviewProviders.length} more providers in
              the chart and breakdown
            </p>
          ) : null}
        </div>
      </section>

      <DailyUsageChart
        daily={providerUsage.daily}
        providers={providers}
        range={usage.range}
      />
    </div>
  );
}

function DailyUsageChart({
  daily,
  providers,
  range,
}: {
  daily: ProviderDailyUsageView[];
  providers: ProviderUsageView[];
  range: UsageRange;
}) {
  const [metric, setMetric] = React.useState<ChartMetric>("cost");
  const chartRows = React.useMemo(
    () => buildDailyChartData(daily, range, metric),
    [daily, metric, range]
  );
  const chartConfig = React.useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        providers.map((provider, index) => [
          provider.providerId,
          {
            color: getProviderColor(provider.providerId, index),
            label: provider.providerDisplayName,
          },
        ])
      ),
    [providers]
  );
  const hasData = chartRows.some((row) =>
    providers.some((provider) => Number(row[provider.providerId]) > 0)
  );

  return (
    <section className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-base">
          Daily {metric === "cost" ? "cost" : "tokens"}
        </h2>
        <div className="flex items-center gap-4">
          <SegmentedControl
            onChange={(value) => setMetric(value as ChartMetric)}
            options={[
              { label: "Cost", value: "cost" },
              { label: "Tokens", value: "tokens" },
            ]}
            value={metric}
          />
          <ProviderLegend providers={providers} />
        </div>
      </div>

      {hasData ? (
        <ChartContainer
          className="h-[300px] w-full aspect-auto"
          config={chartConfig}
        >
          <AreaChart
            accessibilityLayer
            data={chartRows}
            margin={{ bottom: 0, left: 0, right: 6, top: 10 }}
          >
            <defs>
              {providers.map((provider, index) => {
                const color = getProviderColor(provider.providerId, index);
                const gradientId = getGradientId(provider.providerId);
                return (
                  <linearGradient
                    id={gradientId}
                    key={provider.providerId}
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor={color} stopOpacity={0.55} />
                    <stop offset="95%" stopColor={color} stopOpacity={0.04} />
                  </linearGradient>
                );
              })}
            </defs>
            <CartesianGrid strokeDasharray="2 5" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="date"
              minTickGap={42}
              tickFormatter={formatDayLabel}
              tickLine={false}
              tickMargin={10}
            />
            <YAxis
              axisLine={false}
              tickFormatter={(value) =>
                metric === "cost"
                  ? formatCompactUsd(Number(value))
                  : formatTokenCount(Number(value))
              }
              tickLine={false}
              tickMargin={8}
              width={52}
            />
            <ChartTooltip
              contentStyle={{
                backgroundColor: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                boxShadow: "0 16px 40px rgb(0 0 0 / 0.22)",
              }}
              cursor={{ stroke: "var(--border)" }}
              formatter={(value, name) => [
                metric === "cost"
                  ? formatUsd(Number(value))
                  : formatTokenCount(Number(value)),
                chartConfig[String(name)]?.label ?? String(name),
              ]}
              labelFormatter={(label) => formatLongDate(String(label))}
            />
            {providers.map((provider, index) => (
              <Area
                dataKey={provider.providerId}
                fill={`url(#${getGradientId(provider.providerId)})`}
                fillOpacity={1}
                key={provider.providerId}
                stackId="usage"
                stroke={getProviderColor(provider.providerId, index)}
                strokeWidth={1.8}
                type="monotone"
              />
            ))}
          </AreaChart>
        </ChartContainer>
      ) : (
        <EmptyState text="No daily usage found in this range." />
      )}
    </section>
  );
}

function UsageMetricStrip({ usage }: { usage: CliUsage }) {
  const inputTokens = usage.totals.inputTokens;
  const cachedInput = usage.totals.cacheInputTokens;
  const uncachedInput = Math.max(0, inputTokens - cachedInput);
  const outputShare = safeRatio(
    usage.totals.outputTokens,
    usage.totals.totalTokens
  );
  const perActiveDay = usage.activeDays
    ? usage.totals.totalTokens / usage.activeDays
    : 0;

  const metrics = [
    {
      detail: `${formatTokenCount(perActiveDay)} per active day`,
      label: "Processed tokens",
      value: formatTokenCount(usage.totals.totalTokens),
    },
    {
      detail: `${formatPercent(safeRatio(cachedInput, inputTokens))} of input`,
      label: "Cached input",
      value: formatTokenCount(cachedInput),
    },
    {
      detail: "input outside cache",
      label: "Uncached input",
      value: formatTokenCount(uncachedInput),
    },
    {
      detail: `${formatPercent(outputShare)} of processed`,
      label: "Output",
      value: formatTokenCount(usage.totals.outputTokens),
    },
    {
      detail: `${usage.currentStreak} day current streak`,
      label: "Active days",
      value: formatNumber(usage.activeDays),
    },
  ];

  return (
    <div className="grid overflow-hidden rounded-xl border border-border/60 bg-muted/15 sm:grid-cols-2 lg:grid-cols-5">
      {metrics.map((metric) => (
        <div
          className="min-w-0 border-border/60 border-b p-4 last:border-b-0 sm:border-r sm:[&:nth-child(even)]:border-r-0 lg:border-b-0 lg:[&:nth-child(even)]:border-r lg:last:border-r-0"
          key={metric.label}
        >
          <div className="truncate text-muted-foreground text-xs">
            {metric.label}
          </div>
          <div className="mt-2 font-medium text-xl tabular-nums tracking-tight">
            {metric.value}
          </div>
          <div className="mt-1 truncate text-muted-foreground/80 text-xs">
            {metric.detail}
          </div>
        </div>
      ))}
    </div>
  );
}

function QuotaEfficiencyComparison({
  data,
  error,
  isLoading,
}: {
  data?: QuotaCycleResult;
  error?: string;
  isLoading: boolean;
}) {
  const rows = (data?.providers ?? [])
    .flatMap((provider) =>
      provider.cycles
        .filter((cycle) => {
          const window = provider.quota.windows.find(
            (candidate) => candidate.id === cycle.windowId
          );
          return !window || !isToolCallQuotaWindow(window);
        })
        .map((cycle) => ({ cycle, provider }))
    )
    .sort(
      (left, right) =>
        confidenceRank(right.cycle.estimate.confidence) -
          confidenceRank(left.cycle.estimate.confidence) ||
        right.cycle.observed.tokens.totalTokens -
          left.cycle.observed.tokens.totalTokens
    );

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border/60">
      <div className="flex flex-wrap items-start justify-between gap-4 border-border/60 border-b bg-muted/10 px-4 py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-muted-foreground" />
            <h2 className="font-semibold text-base">Quota efficiency</h2>
          </div>
          <p className="mt-1 text-muted-foreground text-xs">
            Provider quota movement correlated with locally attributed usage in
            the current cycle.
          </p>
        </div>
        <Link
          className="inline-flex items-center gap-1 font-medium text-xs hover:text-primary"
          to="/settings/quota"
        >
          Inspect quota cycles
          <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      {isLoading ? (
        <div className="p-6 text-center text-muted-foreground text-sm">
          Correlating quota snapshots with local usage…
        </div>
      ) : error ? (
        <div className="p-6 text-center text-destructive text-sm">
          Failed to load quota efficiency: {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground text-sm">
          No active provider quota windows were detected.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-muted/10 text-muted-foreground text-xs">
              <tr className="border-border/60 border-b">
                <th className="px-4 py-2.5 font-medium">Provider / window</th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Remaining
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Local tokens
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Observed API cost
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Projected full cycle
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Confidence
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ cycle, provider }) => (
                <QuotaEfficiencyRow
                  cycle={cycle}
                  key={`${provider.quota.providerId}:${cycle.windowId}`}
                  provider={provider}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-border/60 border-t bg-muted/10 px-4 py-2.5 text-muted-foreground text-[11px]">
        Local-only estimate, not a provider guarantee. Usage from other devices
        and unsupported clients can lower apparent full-cycle projections.
      </div>
    </section>
  );
}

function QuotaEfficiencyRow({
  cycle,
  provider,
}: {
  cycle: QuotaCycle;
  provider: QuotaCycleProvider;
}) {
  const window = provider.quota.windows.find(
    (candidate) => candidate.id === cycle.windowId
  );
  const remaining = window?.unlimited
    ? "∞"
    : window?.percentRemaining === undefined
      ? "n/a"
      : `${trimNumber(window.percentRemaining)}%`;
  const estimate = cycle.estimate;

  return (
    <tr className="border-border/50 border-b last:border-b-0">
      <td className="px-4 py-3">
        <div className="font-medium">{provider.quota.displayName}</div>
        <div className="mt-0.5 text-muted-foreground text-xs">
          {cycle.label} ·{" "}
          {cycle.observed.partialCycle ? "partial local cycle" : "full cycle"}
        </div>
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {remaining}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <div className="font-medium">
          {formatTokenCount(cycle.observed.tokens.totalTokens)}
        </div>
        <div className="mt-0.5 text-muted-foreground text-[11px]">
          {formatTokenCount(cycle.observed.tokens.inputTokens)} in ·{" "}
          {formatTokenCount(cycle.observed.tokens.cacheInputTokens)} cache ·{" "}
          {formatTokenCount(cycle.observed.tokens.outputTokens)} out
        </div>
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {formatUsd(cycle.observed.apiEquivalent.totalUsd)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {estimate.projectedTokenCapacity === undefined ? (
          <span className="text-muted-foreground">Learning</span>
        ) : (
          <>
            <div className="font-medium">
              {estimate.projectedApiEquivalent === undefined
                ? "API cost unavailable"
                : `~${formatUsd(estimate.projectedApiEquivalent)}`}
            </div>
            <div className="mt-0.5 text-muted-foreground text-[11px]">
              ~{formatTokenCount(estimate.projectedTokenCapacity)} tokens
            </div>
          </>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <Badge
          title={estimate.reasons.join("\n")}
          variant={getQuotaConfidenceVariant(estimate.confidence)}
        >
          {formatQuotaConfidence(estimate.confidence)}
        </Badge>
      </td>
    </tr>
  );
}

function confidenceRank(
  confidence: QuotaCycle["estimate"]["confidence"]
): number {
  if (confidence === "high") {
    return 3;
  }
  if (confidence === "medium") {
    return 2;
  }
  if (confidence === "low") {
    return 1;
  }
  return 0;
}

function getQuotaConfidenceVariant(
  confidence: QuotaCycle["estimate"]["confidence"]
) {
  if (confidence === "high") {
    return "default";
  }
  if (confidence === "medium" || confidence === "low") {
    return "secondary";
  }
  return "outline";
}

function formatQuotaConfidence(
  confidence: QuotaCycle["estimate"]["confidence"]
): string {
  if (confidence === "unavailable") {
    return "Learning";
  }
  return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)}`;
}

function BreakdownTable({
  providerUsage,
  usage,
}: {
  providerUsage: ProviderCentricUsageView;
  usage: CliUsage;
}) {
  const [mode, setMode] = React.useState<BreakdownMode>("model");
  const models = [...providerUsage.modelUsage]
    .sort(
      (left, right) =>
        right.cost.totalUsd - left.cost.totalUsd ||
        right.tokens.totalTokens - left.tokens.totalTokens
    )
    .slice(0, 12);
  const days = [...usage.daily]
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 12);
  const isEmpty = mode === "model" ? models.length === 0 : days.length === 0;

  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-base">Breakdown</h2>
        <SegmentedControl
          onChange={(value) => setMode(value as BreakdownMode)}
          options={[
            { label: "Model", value: "model" },
            { label: "Day", value: "day" },
          ]}
          value={mode}
        />
      </div>

      {isEmpty ? (
        <EmptyState
          text={`No ${mode === "model" ? "model" : "daily"} usage found.`}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="border-border/60 border-b text-left text-muted-foreground text-xs">
                <th className="py-3 pr-4 font-normal">
                  {mode === "model" ? "Model" : "Day"}
                </th>
                <th className="px-4 py-3 text-right font-normal">Cost</th>
                <th className="px-4 py-3 text-right font-normal">Share</th>
                <th className="py-3 pl-4 text-right font-normal">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {mode === "model"
                ? models.map((model, index) => (
                    <ModelBreakdownRow
                      index={index}
                      key={model.key}
                      model={model}
                      usage={usage}
                    />
                  ))
                : days.map((day) => (
                    <DayBreakdownRow day={day} key={day.date} usage={usage} />
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ModelBreakdownRow({
  index,
  model,
  usage,
}: {
  index: number;
  model: ProviderModelUsageView;
  usage: CliUsage;
}) {
  const share = getCostOrTokenShare(
    model.cost.totalUsd,
    model.tokens.totalTokens,
    usage.cost.totalUsd,
    usage.totals.totalTokens
  );
  return (
    <tr className="border-border/45 border-b last:border-b-0">
      <td className="max-w-0 py-3 pr-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <ProviderMark color={getProviderColor(model.providerId, index)} />
          <div className="min-w-0">
            <div className="truncate font-medium" title={model.displayName}>
              {model.displayName}
            </div>
            <div className="truncate text-muted-foreground text-xs">
              {model.providerDisplayName}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {formatUsd(model.cost.totalUsd)}
      </td>
      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
        {formatPercent(share)}
      </td>
      <td className="py-3 pl-4 text-right text-muted-foreground tabular-nums">
        {formatTokenCount(model.tokens.totalTokens)}
      </td>
    </tr>
  );
}

function DayBreakdownRow({ day, usage }: { day: CliDaily; usage: CliUsage }) {
  const share = getCostOrTokenShare(
    day.cost.totalUsd,
    day.tokens.totalTokens,
    usage.cost.totalUsd,
    usage.totals.totalTokens
  );
  return (
    <tr className="border-border/45 border-b last:border-b-0">
      <td className="py-3 pr-4 font-medium">{formatLongDate(day.date)}</td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {formatUsd(day.cost.totalUsd)}
      </td>
      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
        {formatPercent(share)}
      </td>
      <td className="py-3 pl-4 text-right text-muted-foreground tabular-nums">
        {formatTokenCount(day.tokens.totalTokens)}
      </td>
    </tr>
  );
}

function CostQuality({
  providerUsage,
  usage,
}: {
  providerUsage: ProviderCentricUsageView;
  usage: CliUsage;
}) {
  const observedTokens =
    usage.pricing.pricedTokens + usage.pricing.unpricedTokens;
  const priceCoverage = safeRatio(usage.pricing.pricedTokens, observedTokens);
  const unpricedCoverage = safeRatio(
    usage.pricing.unpricedTokens,
    observedTokens
  );
  const modelCoverage = providerUsage.modelUsage.filter(
    (model) => model.cost.pricedTokens > 0
  ).length;
  const qualityRows = [
    { label: "Priced coverage", value: formatPercent(priceCoverage) },
    {
      label: "Models priced",
      value: `${modelCoverage}/${providerUsage.modelUsage.length}`,
    },
    {
      label: "Unpriced",
      value: formatPercent(unpricedCoverage),
    },
    {
      label: "Cache hit rate",
      value: formatPercent(
        safeRatio(usage.totals.cacheInputTokens, usage.totals.inputTokens)
      ),
    },
  ];

  return (
    <aside className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-base">Cost quality</h2>
        <Badge className="font-normal" variant="outline">
          {providerUsage.providers.length} providers observed
        </Badge>
      </div>
      <div>
        {qualityRows.map((row) => (
          <div
            className="flex items-center justify-between gap-5 border-border/50 border-b py-3 text-sm"
            key={row.label}
          >
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-medium tabular-nums">{row.value}</span>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-2">
        {providerUsage.providers.map((provider, index) => (
          <div
            className="flex items-center justify-between gap-3 text-xs"
            key={provider.providerId}
          >
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <ProviderMark
                color={getProviderColor(provider.providerId, index)}
              />
              <span className="truncate">{provider.providerDisplayName}</span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              {provider.modelCount}{" "}
              {provider.modelCount === 1 ? "model" : "models"}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function SegmentedControl({
  onChange,
  options,
  value,
}: {
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border/60 bg-muted/20 p-0.5">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={cn(
            "h-7 rounded-md px-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wide transition-colors hover:text-foreground",
            value === option.value &&
              "bg-background text-foreground shadow-sm ring-1 ring-border/50"
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ProviderLegend({ providers }: { providers: ProviderUsageView[] }) {
  return (
    <div className="hidden items-center gap-3 xl:flex">
      {providers.slice(0, 3).map((provider, index) => (
        <span
          className="inline-flex items-center gap-1.5 text-muted-foreground text-xs"
          key={provider.providerId}
        >
          <ProviderMark color={getProviderColor(provider.providerId, index)} />
          {provider.providerDisplayName}
        </span>
      ))}
    </div>
  );
}

function ProviderMark({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-2.5 shrink-0 rounded-full ring-2 ring-background"
      style={{ backgroundColor: color }}
    />
  );
}

function TelemetryOptIn({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label
      className="flex items-center justify-between gap-5 border-border/60 border-t pt-5"
      htmlFor="usage-telemetry-enabled"
    >
      <span className="min-w-0">
        <span className="block font-medium text-sm">Telemetry opt-in</span>
        <span className="mt-0.5 block text-muted-foreground text-xs">
          Local counters stay on this device unless external telemetry is
          enabled.
        </span>
      </span>
      <Switch
        checked={checked}
        disabled={disabled}
        id="usage-telemetry-enabled"
        onCheckedChange={onChange}
      />
    </label>
  );
}

function UsageNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-amber-700 text-xs leading-5 dark:text-amber-300">
      {children}
    </div>
  );
}

function UsageLoadingState({ isSlow }: { isSlow: boolean }) {
  return (
    <div className="grid gap-8">
      <div className="grid animate-pulse gap-10 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.55fr)]">
        <div>
          <div className="h-3 w-32 rounded bg-muted" />
          <div className="mt-4 h-12 w-52 rounded bg-muted" />
          <div className="mt-8 grid gap-5">
            <div className="h-12 rounded bg-muted/70" />
            <div className="h-12 rounded bg-muted/70" />
          </div>
        </div>
        <div className="h-[330px] rounded-xl bg-muted/50" />
      </div>
      <div className="h-28 animate-pulse rounded-xl bg-muted/40" />
      {isSlow ? (
        <p className="text-center text-muted-foreground text-sm">
          Usage statistics is still loading. Check the server connection, then
          refresh.
        </p>
      ) : null}
    </div>
  );
}

function LegacyUsageFallback({
  disabled,
  onTelemetryChange,
  summary,
}: {
  disabled: boolean;
  onTelemetryChange: (enabled: boolean) => void;
  summary: UsageSummary;
}) {
  const metrics = [
    {
      icon: Activity,
      label: "Internal tokens",
      value: formatTokenCount(
        summary.totals.inputTokens + summary.totals.outputTokens
      ),
    },
    {
      icon: Sparkles,
      label: "Prompts",
      value: formatNumber(summary.totals.promptCount),
    },
    {
      icon: CalendarDays,
      label: "Active chats",
      value: formatNumber(summary.totals.activeChats),
    },
    {
      icon: BarChart3,
      label: "Quota refreshes",
      value: formatNumber(summary.totals.quotaRefreshCount),
    },
  ];

  return (
    <div className="grid gap-6">
      <UsageNotice>
        The server response does not include CLI usage data. Restart the server
        process that serves tRPC, then refresh this page.
      </UsageNotice>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div className="rounded-xl border p-4" key={metric.label}>
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <Icon className="size-3.5" />
                {metric.label}
              </div>
              <div className="mt-3 font-semibold text-2xl tabular-nums">
                {metric.value}
              </div>
            </div>
          );
        })}
      </div>
      <TelemetryOptIn
        checked={summary.telemetry.enabled}
        disabled={disabled}
        onChange={onTelemetryChange}
      />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-44 items-center justify-center rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm">
      {text}
    </div>
  );
}

function buildDailyChartData(
  daily: ProviderDailyUsageView[],
  range: UsageRange,
  metric: ChartMetric
): DailyChartDatum[] {
  if (daily.length === 0) {
    return [];
  }
  const dates = getChartDates(daily, range);
  const byDate = new Map(daily.map((row) => [row.date, row]));
  const providerIds = new Set(
    daily.flatMap((row) => row.providers.map((provider) => provider.providerId))
  );

  return dates.map((date) => {
    const dailyRow = byDate.get(date);
    const row: DailyChartDatum = {
      date,
      totalCost: dailyRow?.cost.totalUsd ?? 0,
      totalTokens: dailyRow?.tokens.totalTokens ?? 0,
    };
    for (const providerId of providerIds) {
      const provider = dailyRow?.providers.find(
        (candidate) => candidate.providerId === providerId
      );
      row[providerId] = provider
        ? metric === "cost"
          ? provider.cost.totalUsd
          : provider.totals.totalTokens
        : 0;
    }
    return row;
  });
}

function getChartDates(
  daily: Array<{ date: string }>,
  range: UsageRange
): string[] {
  if (range !== "all") {
    return getDateSequence(
      formatLocalDate(new Date()),
      range === "7d" ? 7 : range === "30d" ? 30 : 2
    );
  }

  const sortedDates = daily.map((row) => row.date).sort();
  const lastDate = sortedDates.at(-1);
  const firstDate = sortedDates[0];
  if (!(lastDate && firstDate)) {
    return [];
  }
  const inclusiveDays = Math.max(
    1,
    differenceInCalendarDays(firstDate, lastDate)
  );
  return getDateSequence(lastDate, Math.min(inclusiveDays, 90));
}

function getDateSequence(endDate: string, days: number): string[] {
  const end = new Date(`${endDate}T00:00:00`);
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  const dates: string[] = [];
  for (
    const cursor = new Date(start);
    cursor <= end;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    dates.push(formatLocalDate(cursor));
  }
  return dates;
}

function differenceInCalendarDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function getProviderShare(
  provider: ProviderUsageView,
  usage: CliUsage
): number {
  return getCostOrTokenShare(
    provider.cost.totalUsd,
    provider.totals.totalTokens,
    usage.cost.totalUsd,
    usage.totals.totalTokens
  );
}

function getCostOrTokenShare(
  cost: number,
  tokens: number,
  totalCost: number,
  totalTokens: number
): number {
  return totalCost > 0
    ? safeRatio(cost, totalCost)
    : safeRatio(tokens, totalTokens);
}

function safeRatio(value: number, total: number): number {
  if (!(Number.isFinite(value) && Number.isFinite(total) && total > 0)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value / total));
}

function getProviderColor(providerId: string, index: number): string {
  return (
    PROVIDER_COLORS[providerId] ??
    FALLBACK_PROVIDER_COLORS[index % FALLBACK_PROVIDER_COLORS.length] ??
    "#94a3b8"
  );
}

function getGradientId(providerId: string): string {
  return `usage-${providerId.replace(/[^a-z0-9-]/gi, "-")}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined).format(value);
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

function formatUsd(value: number, preserveCents = false): string {
  if (!(Number.isFinite(value) && value > 0)) {
    return "$0.00";
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  const fractionDigits = preserveCents || value < 100 ? 2 : 0;
  return new Intl.NumberFormat(undefined, {
    currency: "USD",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
    style: "currency",
  }).format(value);
}

function formatCompactUsd(value: number): string {
  if (value >= 1_000_000) {
    return `$${trimNumber(value / 1_000_000)}M`;
  }
  if (value >= 1000) {
    return `$${trimNumber(value / 1000)}K`;
  }
  if (value >= 1) {
    return `$${trimNumber(value)}`;
  }
  if (value > 0) {
    return `$${value.toFixed(2)}`;
  }
  return "$0";
}

function formatPercent(value: number): string {
  const percentage = Math.max(0, Math.min(1, value)) * 100;
  return `${percentage >= 10 ? percentage.toFixed(1) : percentage.toFixed(2)}%`;
}

function trimNumber(value: number): string {
  return value >= 10
    ? value.toFixed(1).replace(/\.0$/, "")
    : value.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

function formatUsagePeriod(daily: CliDaily[], range: UsageRange): string {
  if (range !== "all") {
    const dates = getDateSequence(
      formatLocalDate(new Date()),
      range === "7d" ? 7 : range === "30d" ? 30 : 2
    );
    const start = dates[0];
    const end = dates.at(-1);
    return start && end
      ? `${formatShortDate(start)} to ${formatShortDate(end)}`
      : `Last ${range}`;
  }
  if (daily.length === 0) {
    return "All recorded activity";
  }
  const dates = daily.map((row) => row.date).sort();
  const start = dates[0];
  const end = dates.at(-1);
  return start && end
    ? `${formatShortDate(start)} to ${formatShortDate(end)}`
    : "Selected period";
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T00:00:00`));
}

function formatLongDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function formatDayLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T00:00:00`));
}

function formatRelativeTimestamp(timestamp: number): string {
  const differenceMs = Date.now() - timestamp;
  if (differenceMs < 60_000) {
    return "just now";
  }
  if (differenceMs < 3_600_000) {
    return `${Math.floor(differenceMs / 60_000)}m ago`;
  }
  if (differenceMs < 86_400_000) {
    return `${Math.floor(differenceMs / 3_600_000)}h ago`;
  }
  return formatShortDate(formatLocalDate(new Date(timestamp)));
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
