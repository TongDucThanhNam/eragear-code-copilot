"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  Activity,
  BarChart3,
  CalendarDays,
  Flame,
  MessageSquare,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type UsageSummary = RouterOutput["usageStats"]["getSummary"];
type CliUsage = NonNullable<UsageSummary["cliUsage"]>;
type CliDaily = CliUsage["daily"][number];
type CliModel = CliUsage["modelUsage"][number];
type CliProvider = CliUsage["providers"][number];
type UsageRange = UsageSummary["range"];

const RANGE_OPTIONS: Array<{ value: UsageRange; label: string }> = [
  { value: "all", label: "All time" },
  { value: "30d", label: "Last 30 days" },
  { value: "7d", label: "Last 7 days" },
  { value: "24h", label: "24 hours" },
];

const PROVIDER_COLORS: Record<string, string> = {
  amp: "#eab308",
  claude: "#d97706",
  codex: "#22c55e",
  cursor: "#0ea5e9",
  gemini: "#8b5cf6",
  opencode: "#f43f5e",
  pi: "#14b8a6",
  zcode: "#6366f1",
};

const HEATMAP_COLORS = [
  "bg-muted",
  "bg-sky-950",
  "bg-sky-800",
  "bg-sky-600",
  "bg-emerald-500",
  "bg-amber-400",
];

export function UsageStatsSettingsPanel() {
  const utils = trpc.useUtils();
  const [range, setRange] = React.useState<UsageRange>("all");
  const summaryQuery = trpc.usageStats.getSummary.useQuery(
    { range, includeCliUsage: true },
    {
      retry: 1,
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
  const cliUsage = summary?.cliUsage;
  const isBusy = summaryQuery.isFetching || updateTelemetry.isPending;
  const [isSlowLoading, setIsSlowLoading] = React.useState(false);

  React.useEffect(() => {
    if (!summaryQuery.isLoading) {
      setIsSlowLoading(false);
      return;
    }

    setIsSlowLoading(false);
    const timeout = window.setTimeout(() => setIsSlowLoading(true), 8000);
    return () => window.clearTimeout(timeout);
  }, [range, summaryQuery.isLoading]);

  return (
    <SettingsSection
      action={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border bg-background p-0.5">
            {RANGE_OPTIONS.map((option) => (
              <Button
                className="h-8 px-2 text-xs"
                key={option.value}
                onClick={() => setRange(option.value)}
                size="sm"
                variant={range === option.value ? "secondary" : "ghost"}
              >
                {option.label}
              </Button>
            ))}
          </div>
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
        </div>
      }
      description="Local token usage aggregated from supported coding CLI logs."
      icon={BarChart3}
      title="Usage Statistics"
    >
      {summaryQuery.isLoading ? (
        <EmptyState
          text={
            isSlowLoading
              ? "Usage statistics is still loading. Check the server connection, then refresh."
              : "Loading usage statistics..."
          }
        />
      ) : summaryQuery.isError ? (
        <EmptyState
          text={`Failed to load usage statistics: ${summaryQuery.error.message}`}
        />
      ) : summary && cliUsage ? (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              icon={Activity}
              label="Token Usage"
              value={formatTokenCount(cliUsage.totals.totalTokens)}
            />
            <Metric
              icon={MessageSquare}
              label="Estimated Cost"
              value={formatUsd(cliUsage.cost.totalUsd)}
              detail={
                cliUsage.pricing.unpricedTokens > 0
                  ? `${formatTokenCount(cliUsage.pricing.unpricedTokens)} unpriced`
                  : "priced API usage"
              }
            />
            <Metric
              icon={CalendarDays}
              label="Active Days"
              value={formatNumber(cliUsage.activeDays)}
            />
            <Metric
              icon={Sparkles}
              label="Models"
              value={formatNumber(cliUsage.modelUsage.length)}
            />
            <Metric
              icon={Flame}
              label="Current Streak"
              value={formatNumber(cliUsage.currentStreak)}
            />
            <Metric
              icon={Activity}
              label="Longest Streak"
              value={formatNumber(cliUsage.longestStreak)}
            />
            <Metric
              label="Favorite Model"
              value={cliUsage.favoriteModel?.name ?? "No data"}
              detail={
                cliUsage.favoriteModel
                  ? `${Math.round(cliUsage.favoriteModel.share * 100)}% share`
                  : undefined
              }
            />
            <Metric
              label="Providers"
              value={`${countReadyProviders(cliUsage.providers)}/${cliUsage.providers.length}`}
              detail="ready"
            />
          </div>

          <UsageHeatmap daily={cliUsage.daily} range={range} />
          <DailyTokenBars daily={cliUsage.daily} range={range} />

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
            <ModelUsageList models={cliUsage.modelUsage} />
            <ProviderStatusList providers={cliUsage.providers} />
          </div>

          {cliUsage.warnings.length > 0 ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-amber-700 text-xs dark:text-amber-300">
              {cliUsage.warnings.slice(0, 3).join(" ")}
            </div>
          ) : null}

          {cliUsage.pricing.unpricedTokens > 0 ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-amber-700 text-xs dark:text-amber-300">
              {formatTokenCount(cliUsage.pricing.unpricedTokens)} tokens do not
              have matching API pricing in the bundled models.dev snapshot and
              are excluded from estimated cost.
            </div>
          ) : null}

          <TelemetryOptIn
            checked={summary.telemetry.enabled}
            disabled={isBusy}
            onChange={(enabled) => updateTelemetry.mutate({ enabled })}
          />
        </div>
      ) : summary ? (
        <div className="grid gap-4">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-amber-700 text-xs dark:text-amber-300">
            The server response does not include CLI usage data. Restart the
            server process that serves tRPC, then refresh this page.
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              icon={Activity}
              label="Internal Tokens"
              value={formatTokenCount(
                summary.totals.inputTokens + summary.totals.outputTokens
              )}
            />
            <Metric
              icon={MessageSquare}
              label="Prompts"
              value={formatNumber(summary.totals.promptCount)}
            />
            <Metric
              icon={CalendarDays}
              label="Active Chats"
              value={formatNumber(summary.totals.activeChats)}
            />
            <Metric
              icon={Sparkles}
              label="Quota Refreshes"
              value={formatNumber(summary.totals.quotaRefreshCount)}
            />
          </div>
          <TelemetryOptIn
            checked={summary.telemetry.enabled}
            disabled={isBusy}
            onChange={(enabled) => updateTelemetry.mutate({ enabled })}
          />
        </div>
      ) : (
        <EmptyState text="No usage statistics response." />
      )}
    </SettingsSection>
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
      className="flex items-center justify-between gap-4 rounded-md border bg-background p-3"
      htmlFor="usage-telemetry-enabled"
    >
      <span className="min-w-0">
        <span className="block font-medium text-sm">Telemetry opt-in</span>
        <span className="block text-muted-foreground text-xs">
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

function Metric({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail?: string;
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="min-h-24 rounded-md border bg-background p-3">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div
        className="mt-3 break-words font-semibold text-2xl leading-tight tabular-nums"
        title={value}
      >
        {value}
      </div>
      {detail ? (
        <div className="mt-1 truncate text-muted-foreground text-xs">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function UsageHeatmap({
  daily,
  range,
}: {
  daily: CliDaily[];
  range: UsageRange;
}) {
  const days = React.useMemo(() => buildHeatmapDays(daily, range), [daily, range]);
  const maxTokens = Math.max(1, ...days.map((day) => day.tokens));

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-medium text-sm">Activity Heatmap</div>
        <div className="flex items-center gap-1 text-muted-foreground text-xs">
          <span>Less</span>
          {HEATMAP_COLORS.map((color, index) => (
            <span
              className={cn("h-3.5 w-3.5 rounded-[3px]", color)}
              key={`${color}-${index}`}
            />
          ))}
          <span>More</span>
        </div>
      </div>
      <div className="overflow-x-auto pb-1">
        <div
          className="grid auto-cols-[12px] grid-flow-col grid-rows-7 gap-1"
          style={{ width: "max-content" }}
        >
          {days.map((day) => (
            <div
              className={cn(
                "h-3 w-3 rounded-[3px]",
                HEATMAP_COLORS[getHeatmapLevel(day.tokens, maxTokens)]
              )}
              key={day.date}
              title={`${day.date}: ${formatTokenCount(day.tokens)}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DailyTokenBars({
  daily,
  range,
}: {
  daily: CliDaily[];
  range: UsageRange;
}) {
  const rows = React.useMemo(() => buildChartRows(daily, range), [daily, range]);
  const maxTokens = Math.max(1, ...rows.map((row) => row.tokens.totalTokens));

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-4 font-medium text-sm">Tokens per Day</div>
      {rows.length === 0 ? (
        <EmptyState text="No token usage found in this range." />
      ) : (
        <div className="overflow-x-auto">
          <div className="flex h-64 min-w-[720px] items-end gap-3 border-muted border-b px-2">
            {rows.map((row) => (
              <div
                className="flex h-full min-w-12 flex-1 flex-col justify-end gap-2"
                key={row.date}
              >
                <div className="flex h-52 items-end">
                  <div
                    className="flex w-full min-w-7 flex-col-reverse overflow-hidden rounded-t-sm"
                    style={{
                      height: `${Math.max(
                        2,
                        (row.tokens.totalTokens / maxTokens) * 100
                      )}%`,
                    }}
                    title={`${row.date}: ${formatTokenCount(row.tokens.totalTokens)} / ${formatUsd(row.cost.totalUsd)}`}
                  >
                    {row.providers.map((provider) => (
                      <div
                        key={provider.providerId}
                        style={{
                          backgroundColor:
                            PROVIDER_COLORS[provider.providerId] ?? "#64748b",
                          height: `${
                            row.tokens.totalTokens > 0
                              ? (provider.tokens.totalTokens /
                                  row.tokens.totalTokens) *
                                100
                              : 0
                          }%`,
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div className="truncate text-center text-muted-foreground text-xs">
                  {formatDayLabel(row.date)}
                </div>
              </div>
            ))}
          </div>
          <ProviderLegend rows={rows} />
        </div>
      )}
    </div>
  );
}

function ProviderLegend({ rows }: { rows: CliDaily[] }) {
  const providers = new Map<string, string>();
  for (const row of rows) {
    for (const provider of row.providers) {
      providers.set(provider.providerId, provider.providerDisplayName);
    }
  }
  if (providers.size === 0) {
    return null;
  }
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground text-xs">
      {[...providers.entries()].map(([providerId, label]) => (
        <span className="inline-flex items-center gap-2" key={providerId}>
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: PROVIDER_COLORS[providerId] ?? "#64748b" }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}

function ModelUsageList({ models }: { models: CliModel[] }) {
  const visibleModels = [...models]
    .sort(
      (a, b) =>
        b.cost.totalUsd - a.cost.totalUsd ||
        b.tokens.totalTokens - a.tokens.totalTokens
    )
    .slice(0, 8);

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-3 font-medium text-sm">Model Usage</div>
      {models.length === 0 ? (
        <EmptyState text="No model usage found." />
      ) : (
        <div className="grid gap-2">
          {visibleModels.map((model) => (
            <div className="grid gap-2 border-b py-2 last:border-b-0" key={`${model.providerId}:${model.name}`}>
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm">{model.name}</div>
                  <div className="mt-1 text-muted-foreground text-xs">
                    {model.providerDisplayName}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold text-sm">
                    {formatUsd(model.cost.totalUsd)}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {formatTokenCount(model.tokens.totalTokens)}
                  </div>
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    backgroundColor:
                      PROVIDER_COLORS[model.providerId] ?? "#64748b",
                    width: `${Math.max(2, model.share * 100)}%`,
                  }}
                />
              </div>
              <div className="text-muted-foreground text-xs">
                {formatTokenCount(model.tokens.inputTokens)} in /{" "}
                {formatTokenCount(model.tokens.outputTokens)} out /{" "}
                {Math.round(model.share * 100)}%
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderStatusList({ providers }: { providers: CliProvider[] }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-3 font-medium text-sm">Providers</div>
      <div className="grid gap-2">
        {providers.map((provider) => (
          <div
            className="flex items-center justify-between gap-3 rounded-md border p-2"
            key={provider.providerId}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{
                    backgroundColor:
                      PROVIDER_COLORS[provider.providerId] ?? "#64748b",
                  }}
                />
                <span className="truncate font-medium text-sm">
                  {provider.providerDisplayName}
                </span>
              </div>
              <div className="mt-1 text-muted-foreground text-xs">
                {formatTokenCount(provider.totals.totalTokens)} /{" "}
                {formatUsd(provider.cost.totalUsd)}
              </div>
            </div>
            <Badge variant={provider.status === "ready" ? "secondary" : "outline"}>
              {formatProviderStatus(provider.status)}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
      {text}
    </div>
  );
}

function buildHeatmapDays(daily: CliDaily[], range: UsageRange) {
  const byDate = new Map(daily.map((row) => [row.date, row]));
  const dates = getDateWindow(daily, range, range === "all" ? 365 : undefined);
  return dates.map((date) => ({
    date,
    tokens: byDate.get(date)?.tokens.totalTokens ?? 0,
  }));
}

function buildChartRows(daily: CliDaily[], range: UsageRange): CliDaily[] {
  if (range === "all") {
    return daily.slice(-14);
  }
  if (range === "30d") {
    return daily.slice(-30);
  }
  if (range === "7d") {
    return daily.slice(-7);
  }
  return daily.slice(-2);
}

function getDateWindow(
  daily: CliDaily[],
  range: UsageRange,
  maxDays?: number
): string[] {
  const end = new Date();
  const start = new Date(end);
  if (range === "24h") {
    start.setDate(end.getDate() - 1);
  } else if (range === "7d") {
    start.setDate(end.getDate() - 6);
  } else if (range === "30d") {
    start.setDate(end.getDate() - 29);
  } else {
    start.setDate(end.getDate() - ((maxDays ?? 365) - 1));
  }

  const dates: string[] = [];
  for (
    const cursor = new Date(start);
    cursor <= end;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    dates.push(formatLocalDate(cursor));
  }

  if (range === "all" && daily.length > 0) {
    const existing = new Set(dates);
    for (const row of daily.slice(-Math.min(daily.length, maxDays ?? 365))) {
      if (!existing.has(row.date)) {
        dates.push(row.date);
      }
    }
    dates.sort((a, b) => a.localeCompare(b));
  }

  return dates;
}

function getHeatmapLevel(tokens: number, maxTokens: number): number {
  if (tokens <= 0) {
    return 0;
  }
  const ratio = tokens / maxTokens;
  if (ratio > 0.8) {
    return 5;
  }
  if (ratio > 0.6) {
    return 4;
  }
  if (ratio > 0.35) {
    return 3;
  }
  if (ratio > 0.15) {
    return 2;
  }
  return 1;
}

function countReadyProviders(providers: CliProvider[]): number {
  return providers.filter((provider) => provider.status === "ready").length;
}

function formatProviderStatus(status: CliProvider["status"]): string {
  if (status === "not_found") {
    return "Not found";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined).format(value);
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${trimNumber(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${trimNumber(value / 1_000)}K`;
  }
  return formatNumber(value);
}

function formatUsd(value: number): string {
  if (!(Number.isFinite(value) && value > 0)) {
    return "$0.00";
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  const fractionDigits = value >= 100 ? 0 : 2;
  return new Intl.NumberFormat(undefined, {
    currency: "USD",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
    style: "currency",
  }).format(value);
}

function trimNumber(value: number): string {
  return value >= 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

function formatDayLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
