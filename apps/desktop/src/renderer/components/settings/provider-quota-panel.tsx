// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import { AlertCircle, Clock3, Gauge, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type QuotaStatus = "ready" | "not_configured" | "unavailable" | "error";

interface QuotaWindowView {
  id: string;
  label: string;
  percentRemaining?: number;
  used?: number;
  total?: number;
  remaining?: number;
  unlimited?: boolean;
  resetAt?: string;
}

interface ProviderQuotaView {
  providerId: string;
  displayName: string;
  status: QuotaStatus;
  attempted: boolean;
  windows: QuotaWindowView[];
  checkedAt: string;
  fetchedAt?: string;
  authSource?: "env" | "local_auth" | "credential";
  error?: {
    code: string;
    message: string;
  };
}

export function ProviderQuotaPanel() {
  const utils = trpc.useUtils();
  const quotaQuery = trpc.quota.list.useQuery(
    { includeUnavailable: true },
    {
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    }
  );
  const refreshQuota = trpc.quota.refresh.useMutation({
    onSuccess: async () => {
      await utils.quota.list.invalidate();
      toast.success("Provider quota refreshed");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to refresh provider quota");
    },
  });

  const providers = (quotaQuery.data?.providers ?? []) as ProviderQuotaView[];
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
      description="Remote quota windows used by provider-aware scheduling."
      icon={Gauge}
      title="Provider Quota"
    >
      <div className="grid gap-3">
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

        {providers.map((provider) => (
          <ProviderQuotaItem key={provider.providerId} provider={provider} />
        ))}
      </div>
    </SettingsSection>
  );
}

function ProviderQuotaItem({ provider }: { provider: ProviderQuotaView }) {
  const timestamp = provider.fetchedAt ?? provider.checkedAt;
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-sm">
              {provider.displayName}
            </h3>
            <Badge variant={getStatusVariant(provider.status)}>
              {formatStatus(provider.status)}
            </Badge>
            {provider.authSource ? (
              <Badge variant="outline">
                {formatAuthSource(provider.authSource)}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-1 text-muted-foreground text-xs">
            <Clock3 className="h-3.5 w-3.5" />
            {formatDateTime(timestamp)}
          </div>
        </div>
        <Badge variant="secondary">{provider.providerId}</Badge>
      </div>

      {provider.error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-destructive text-xs">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">{provider.error.message}</span>
        </div>
      ) : null}

      {provider.windows.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2">
          {provider.windows.map((window) => (
            <QuotaWindowItem key={window.id} window={window} />
          ))}
        </div>
      ) : provider.status === "ready" ? (
        <div className="rounded-md border border-dashed p-3 text-muted-foreground text-xs">
          Provider returned no quota windows.
        </div>
      ) : null}
    </div>
  );
}

function QuotaWindowItem({ window }: { window: QuotaWindowView }) {
  const percent = window.unlimited ? 100 : window.percentRemaining;
  return (
    <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="truncate font-medium text-xs">{window.label}</div>
        <div className="shrink-0 font-mono text-xs">
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
        {window.resetAt ? <span>{formatReset(window.resetAt)}</span> : null}
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

function formatReset(value: string): string {
  return `Reset ${formatDateTime(value)}`;
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}
