// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  Blocks,
  Box,
  CheckCircle2,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type PluginsOverview = RouterOutput["plugins"]["getOverview"];
type Plugin = PluginsOverview["plugins"][number];
type Registry = PluginsOverview["registries"][number];

export function PluginsSettingsPanel() {
  const utils = trpc.useUtils();
  const overviewQuery = trpc.plugins.getOverview.useQuery(undefined, {
    staleTime: 30_000,
  });

  const updateOverviewCache = async (data: PluginsOverview) => {
    utils.plugins.getOverview.setData(undefined, data);
    await utils.settings.getLocalAdeSnapshot.invalidate();
  };

  const togglePlugin = trpc.plugins.toggle.useMutation({
    onSuccess: async (data) => {
      await updateOverviewCache(data);
      toast.success("Plugin state updated");
    },
    onError: (error) => toast.error(error.message || "Failed to update plugin"),
  });

  const refreshRegistry = trpc.plugins.refreshRegistry.useMutation({
    onSuccess: async (data) => {
      await updateOverviewCache(data);
      toast.success("Plugin registry refreshed");
    },
    onError: (error) =>
      toast.error(error.message || "Failed to refresh registry"),
  });

  const overview = overviewQuery.data;
  const isBusy =
    overviewQuery.isFetching ||
    togglePlugin.isPending ||
    refreshRegistry.isPending;

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy}
          onClick={() => void overviewQuery.refetch()}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={cn(
              "mr-2 h-4 w-4",
              overviewQuery.isFetching ? "animate-spin" : ""
            )}
          />
          Refresh
        </Button>
      }
      description="Dedicated plugin API surface for SDK metadata, lifecycle readiness, and marketplace registries."
      icon={Blocks}
      title="Plugins"
    >
      {overview ? (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Installed" value={overview.lifecycle.total} />
            <Metric label="Ready" value={overview.lifecycle.ready} />
            <Metric label="Needs trust" value={overview.lifecycle.needsTrust} />
            <Metric
              label="Marketplace"
              value={overview.marketplace.registryPackages}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div className="grid gap-3">
              <PanelHeader
                detail={`${overview.lifecycle.enabled} enabled / ${overview.lifecycle.disabled} disabled`}
                icon={CheckCircle2}
                title="Lifecycle"
              />
              {overview.plugins.length === 0 ? (
                <EmptyState text="No project plugins are configured yet." />
              ) : (
                <div className="grid gap-2">
                  {overview.plugins.map((plugin) => (
                    <PluginRow
                      disabled={isBusy}
                      key={plugin.id}
                      onToggle={(enabled) =>
                        togglePlugin.mutate({ id: plugin.id, enabled })
                      }
                      plugin={plugin}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-3">
              <PanelHeader
                detail={overview.sdk.manifestVersion}
                icon={Box}
                title="SDK"
              />
              <div className="grid gap-3 rounded-md border bg-background p-3">
                <div>
                  <div className="text-muted-foreground text-xs">
                    Manifest files
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {overview.sdk.manifestFileNames.map((name) => (
                      <Badge key={name} variant="outline">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Scopes</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {overview.sdk.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="rounded-md bg-muted p-2 font-mono text-[11px] text-muted-foreground">
                  {overview.sdk.manifestExample.command}{" "}
                  {overview.sdk.manifestExample.args.join(" ")}
                </div>
              </div>

              <PanelHeader
                detail={`${overview.lifecycle.dueSchedules} due`}
                icon={PackageCheck}
                title="Scheduled batches"
              />
              {overview.batchSchedules.length === 0 ? (
                <EmptyState text="No plugin batch schedules are configured." />
              ) : (
                <div className="grid gap-2">
                  {overview.batchSchedules.slice(0, 6).map((schedule) => (
                    <div
                      className="rounded-md border bg-background p-3"
                      key={schedule.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-sm">
                            {schedule.name}
                          </div>
                          <div className="truncate text-muted-foreground text-xs">
                            {schedule.pluginNames.join(", ") ||
                              schedule.presetId}
                          </div>
                        </div>
                        <Badge variant="outline">{schedule.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-3">
            <PanelHeader
              detail={`${overview.marketplace.trustedRegistries} trusted / ${overview.marketplace.registries} total`}
              icon={ShieldCheck}
              title="Marketplace"
            />
            {overview.registries.length === 0 ? (
              <EmptyState text="No plugin registries are configured." />
            ) : (
              <div className="grid gap-2">
                {overview.registries.map((registry) => (
                  <RegistryRow
                    disabled={isBusy}
                    key={registry.id}
                    onRefresh={() =>
                      refreshRegistry.mutate({ registryId: registry.id })
                    }
                    registry={registry}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <EmptyState text="Loading plugin overview..." />
      )}
    </SettingsSection>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 font-semibold text-2xl tabular-nums">
        {new Intl.NumberFormat(undefined).format(value)}
      </div>
    </div>
  );
}

function PanelHeader({
  detail,
  icon: Icon,
  title,
}: {
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 font-medium text-sm">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
      </div>
      <span className="text-muted-foreground text-xs">{detail}</span>
    </div>
  );
}

function PluginRow({
  disabled,
  onToggle,
  plugin,
}: {
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  plugin: Plugin;
}) {
  const ready = isReadyPlugin(plugin);
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate font-medium text-sm">{plugin.name}</div>
          <Badge variant={ready ? "default" : "outline"}>
            {ready ? "ready" : "attention"}
          </Badge>
          <Badge variant="secondary">{plugin.policyPreset}</Badge>
        </div>
        <div className="mt-1 truncate text-muted-foreground text-xs">
          {plugin.command} {plugin.args.join(" ")}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge
            variant={
              plugin.trustStatus === "trusted" ? "outline" : "destructive"
            }
          >
            trust: {plugin.trustStatus}
          </Badge>
          <Badge
            variant={
              plugin.permissionStatus === "granted" ? "outline" : "destructive"
            }
          >
            permission: {plugin.permissionStatus}
          </Badge>
          <Badge variant="outline">schedule: {plugin.scheduling.status}</Badge>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3">
        <span className="text-muted-foreground text-xs">
          {plugin.enabled ? "Enabled" : "Disabled"}
        </span>
        <Switch
          checked={plugin.enabled}
          disabled={disabled}
          onCheckedChange={onToggle}
        />
      </div>
    </div>
  );
}

function RegistryRow({
  disabled,
  onRefresh,
  registry,
}: {
  disabled: boolean;
  onRefresh: () => void;
  registry: Registry;
}) {
  const packageCounts = summarizeRegistryPackages(registry);
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3 lg:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate font-medium text-sm">{registry.name}</div>
          <Badge variant="outline">{registry.status}</Badge>
          <Badge
            variant={
              registry.trustStatus === "trusted" ? "secondary" : "destructive"
            }
          >
            {registry.trustStatus}
          </Badge>
        </div>
        <div className="mt-1 truncate text-muted-foreground text-xs">
          {registry.url}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge variant="outline">{packageCounts.total} packages</Badge>
          <Badge variant="outline">
            {packageCounts.installable} installable
          </Badge>
          <Badge variant="outline">
            {packageCounts.updateAvailable} updates
          </Badge>
        </div>
      </div>
      <Button
        disabled={disabled || registry.trustStatus !== "trusted"}
        onClick={onRefresh}
        size="sm"
        variant="outline"
      >
        <RefreshCw className="mr-2 h-4 w-4" />
        Refresh
      </Button>
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

function isReadyPlugin(plugin: Plugin): boolean {
  return (
    plugin.enabled &&
    plugin.trustStatus === "trusted" &&
    plugin.permissionStatus === "granted" &&
    plugin.executionPolicy.status === "allowed" &&
    plugin.scheduling.status === "ready" &&
    plugin.packageExpiryStatus !== "expired" &&
    plugin.packageGovernanceStatus !== "verification-failed"
  );
}

function summarizeRegistryPackages(registry: Registry) {
  return {
    total: registry.packages.length,
    installable: registry.packages.filter(
      (item) => item.status === "installable"
    ).length,
    updateAvailable: registry.packages.filter(
      (item) => item.status === "update-available"
    ).length,
  };
}
