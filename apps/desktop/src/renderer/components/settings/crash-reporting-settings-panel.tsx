// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { Bug, RefreshCw, Save } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type CrashConfig = RouterOutput["crashReporting"]["getStatus"]["config"];
type CrashReport =
  RouterOutput["crashReporting"]["getStatus"]["reports"][number];

const EMPTY_FORM: CrashConfig = {
  enabled: true,
  sentryDsn: "",
  captureUnhandled: true,
  includeStack: true,
  archiveLimit: 100,
  updatedAt: 0,
};

export function CrashReportingSettingsPanel() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<CrashConfig>(EMPTY_FORM);
  const statusQuery = trpc.crashReporting.getStatus.useQuery(undefined, {
    staleTime: 30_000,
  });
  const updateConfig = trpc.crashReporting.updateConfig.useMutation({
    onSuccess: async (status) => {
      setForm(status.config);
      await utils.crashReporting.getStatus.invalidate();
      toast.success("Crash reporting updated");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update crash reporting");
    },
  });

  useEffect(() => {
    if (statusQuery.data?.config) {
      setForm(statusQuery.data.config);
    }
  }, [statusQuery.data?.config]);

  const reports = statusQuery.data?.reports ?? [];
  const isBusy = statusQuery.isFetching || updateConfig.isPending;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateConfig.mutate({
      enabled: form.enabled,
      sentryDsn: form.sentryDsn,
      captureUnhandled: form.captureUnhandled,
      includeStack: form.includeStack,
      archiveLimit: form.archiveLimit,
    });
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
      description="Local crash archive with optional Sentry envelope delivery."
      icon={Bug}
      title="Crash Reporting"
    >
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-wrap gap-2">
          <Badge variant={form.enabled ? "secondary" : "outline"}>
            {form.enabled ? "enabled" : "disabled"}
          </Badge>
          <Badge variant={form.sentryDsn ? "secondary" : "outline"}>
            {form.sentryDsn ? "Sentry configured" : "local only"}
          </Badge>
          <Badge variant="outline">{reports.length} archived</Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <ToggleField
            checked={form.enabled}
            label="Enabled"
            onCheckedChange={(enabled) =>
              setForm((prev) => ({ ...prev, enabled }))
            }
          />
          <ToggleField
            checked={form.captureUnhandled}
            label="Capture unhandled"
            onCheckedChange={(captureUnhandled) =>
              setForm((prev) => ({ ...prev, captureUnhandled }))
            }
          />
          <ToggleField
            checked={form.includeStack}
            label="Include stack"
            onCheckedChange={(includeStack) =>
              setForm((prev) => ({ ...prev, includeStack }))
            }
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_160px]">
          <div className="grid gap-1.5">
            <Label htmlFor="crash-sentry-dsn">Sentry DSN</Label>
            <Input
              id="crash-sentry-dsn"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, sentryDsn: event.target.value }))
              }
              placeholder="https://public@sentry.example.com/123"
              value={form.sentryDsn}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="crash-archive-limit">Archive limit</Label>
            <Input
              id="crash-archive-limit"
              max={1000}
              min={10}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  archiveLimit: Number(event.target.value),
                }))
              }
              type="number"
              value={form.archiveLimit}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button disabled={isBusy} type="submit">
            <Save className="mr-2 h-4 w-4" />
            Save crash config
          </Button>
        </div>
      </form>

      <div className="mt-4 grid gap-3">
        <div className="font-medium text-sm">Archive</div>
        {reports.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            No crash reports archived.
          </div>
        ) : (
          reports.map((report) => (
            <CrashReportRow key={report.id} report={report} />
          ))
        )}
      </div>
    </SettingsSection>
  );
}

function ToggleField({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = `crash-reporting-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <label
      className="flex min-h-10 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
      htmlFor={id}
    >
      <span className="text-sm">{label}</span>
      <Switch checked={checked} id={id} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function CrashReportRow({ report }: { report: CrashReport }) {
  return (
    <div className="grid gap-2 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={report.level === "fatal" ? "destructive" : "outline"}
            >
              {report.level}
            </Badge>
            <Badge variant="outline">{report.source}</Badge>
            {report.sentry.attempted ? (
              <Badge variant={report.sentry.ok ? "secondary" : "destructive"}>
                sentry {report.sentry.status ?? "failed"}
              </Badge>
            ) : null}
          </div>
          <div className="mt-2 font-medium text-sm">{report.message}</div>
        </div>
        <div className="shrink-0 text-muted-foreground text-xs">
          {formatTimestamp(report.createdAt)}
        </div>
      </div>
      {report.stack ? (
        <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
          {report.stack}
        </pre>
      ) : null}
    </div>
  );
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
