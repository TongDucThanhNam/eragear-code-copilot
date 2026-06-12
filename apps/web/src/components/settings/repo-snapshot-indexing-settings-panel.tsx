"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  Archive,
  Database,
  FileText,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type RepoSnapshotOverview = RouterOutput["repoSnapshotIndexing"]["getOverview"];
type SearchResult =
  RouterOutput["repoSnapshotIndexing"]["search"]["results"][number];

export function RepoSnapshotIndexingSettingsPanel() {
  const utils = trpc.useUtils();
  const [searchText, setSearchText] = React.useState("");
  const [activeQuery, setActiveQuery] = React.useState("");
  const overviewQuery = trpc.repoSnapshotIndexing.getOverview.useQuery(
    undefined,
    {
      staleTime: 30_000,
    }
  );
  const searchQuery = trpc.repoSnapshotIndexing.search.useQuery(
    { query: activeQuery || "index" },
    {
      enabled: activeQuery.length > 0,
      staleTime: 30_000,
    }
  );

  const updateOverviewCache = async (data: RepoSnapshotOverview) => {
    utils.repoSnapshotIndexing.getOverview.setData(undefined, data);
    await utils.settings.getLocalAdeSnapshot.invalidate();
  };

  const updateSettings = trpc.repoSnapshotIndexing.updateSettings.useMutation({
    onSuccess: async (data) => {
      await updateOverviewCache(data);
      toast.success(
        data.settings.enabled
          ? "Repo snapshot indexing enabled"
          : "Repo snapshot indexing disabled"
      );
    },
    onError: (error) =>
      toast.error(error.message || "Failed to update repo snapshot indexing"),
  });

  const refresh = trpc.repoSnapshotIndexing.refresh.useMutation({
    onSuccess: async (data) => {
      await updateOverviewCache(data);
      await utils.repoSnapshotIndexing.search.invalidate();
      toast.success("Repo snapshot refreshed");
    },
    onError: (error) =>
      toast.error(error.message || "Failed to refresh repo snapshot"),
  });

  const overview = overviewQuery.data;
  const isBusy =
    overviewQuery.isFetching ||
    updateSettings.isPending ||
    refresh.isPending ||
    searchQuery.isFetching;

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) {
      toast.error("Search query is required");
      return;
    }
    setActiveQuery(query);
  };

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy || overview?.settings.enabled === false}
          onClick={() => refresh.mutate({ reason: "manual-refresh" })}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={cn("mr-2 h-4 w-4", refresh.isPending ? "animate-spin" : "")}
          />
          Refresh
        </Button>
      }
      description="Codebase index snapshots, manifest history, and search retrieval for project context."
      icon={Archive}
      title="Repo Snapshot Indexing"
    >
      {overview ? (
        <div className="grid gap-4">
          <label
            className="flex items-center justify-between gap-4 rounded-md border bg-background p-3"
            htmlFor="repo-snapshot-indexing-enabled"
          >
            <span className="min-w-0">
              <span className="block font-medium text-sm">
                Snapshot indexing
              </span>
              <span className="block truncate text-muted-foreground text-xs">
                {shortPath(overview.projectRoot)}
              </span>
            </span>
            <Switch
              checked={overview.settings.enabled}
              disabled={isBusy}
              id="repo-snapshot-indexing-enabled"
              onCheckedChange={(enabled) =>
                updateSettings.mutate({ enabled, refreshNow: enabled })
              }
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Metric label="Status" value={overview.status} />
            <Metric label="Files" value={overview.index.indexedFiles} />
            <Metric label="Symbols" value={overview.index.symbols.length} />
            <Metric label="Tasks" value={overview.index.tasks.length} />
            <Metric label="Manifests" value={overview.storage.manifests.length} />
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid gap-3">
              <PanelHeader
                detail={
                  overview.index.indexedAt
                    ? formatDateTime(overview.index.indexedAt)
                    : "not indexed"
                }
                icon={Database}
                title="Index"
              />
              <div className="rounded-md border bg-background p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <InfoLine
                    label="Storage"
                    value={shortPath(overview.index.storagePath)}
                  />
                  <InfoLine
                    label="Semantic"
                    value={`${overview.index.semantic.status} / ${overview.index.semantic.source}`}
                  />
                  <InfoLine
                    label="Bytes"
                    value={formatBytes(overview.index.totalBytes)}
                  />
                  <InfoLine
                    label="Tokens"
                    value={String(overview.index.semantic.tokenCount)}
                  />
                </div>
                {overview.index.extensions.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {overview.index.extensions.map((item) => (
                      <Badge key={item.extension} variant="outline">
                        {item.extension} {item.count}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>

              <form className="flex gap-2" onSubmit={submitSearch}>
                <Input
                  disabled={!overview.settings.enabled}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search indexed files, symbols, or task markers"
                  value={searchText}
                />
                <Button
                  disabled={!overview.settings.enabled || searchQuery.isFetching}
                  type="submit"
                  variant="outline"
                >
                  <Search className="mr-2 h-4 w-4" />
                  Search
                </Button>
              </form>

              <SearchResults
                activeQuery={activeQuery}
                isFetching={searchQuery.isFetching}
                results={searchQuery.data?.results ?? []}
                status={searchQuery.data?.status}
              />
            </div>

            <div className="grid gap-3">
              <PanelHeader
                detail={shortPath(overview.storage.manifestDir)}
                icon={FileText}
                title="Snapshot manifests"
              />
              {overview.storage.manifests.length === 0 ? (
                <EmptyState text="No snapshot manifests have been written yet." />
              ) : (
                <div className="grid gap-2">
                  {overview.storage.manifests.slice(0, 8).map((manifest) => (
                    <div
                      className="rounded-md border bg-background p-3"
                      key={manifest.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-sm">
                            {manifest.reason}
                          </div>
                          <div className="truncate text-muted-foreground text-xs">
                            {manifest.id}
                          </div>
                        </div>
                        <Badge variant="outline">
                          {manifest.semanticStatus}
                        </Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <span>{manifest.indexedFiles} files</span>
                        <span>{manifest.symbolCount} symbols</span>
                        <span>{manifest.taskCount} tasks</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {overview.diagnostics.slice(0, 3).map((diagnostic) => (
                <div
                  className="rounded-md border bg-muted/20 p-2 text-muted-foreground text-xs"
                  key={diagnostic}
                >
                  <ShieldAlert className="mr-1 inline h-3.5 w-3.5" />
                  {diagnostic}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <EmptyState text="Loading repo snapshot index..." />
      )}
    </SettingsSection>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 truncate font-semibold text-xl tabular-nums">
        {typeof value === "number"
          ? new Intl.NumberFormat(undefined).format(value)
          : value}
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
      <span className="truncate text-muted-foreground text-xs">{detail}</span>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="truncate font-medium text-sm">{value}</div>
    </div>
  );
}

function SearchResults({
  activeQuery,
  isFetching,
  results,
  status,
}: {
  activeQuery: string;
  isFetching: boolean;
  results: SearchResult[];
  status?: string;
}) {
  if (!activeQuery) {
    return <EmptyState text="Run a search to inspect indexed context." />;
  }
  if (isFetching) {
    return <EmptyState text="Searching repo snapshot index..." />;
  }
  if (results.length === 0) {
    return <EmptyState text={`No results for "${activeQuery}" (${status ?? "idle"}).`} />;
  }
  return (
    <div className="grid gap-2">
      {results.map((result) => (
        <div
          className="rounded-md border bg-background p-3"
          key={`${result.type}:${result.path}:${result.line ?? 0}:${result.title}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{result.type}</Badge>
            <div className="min-w-0 truncate font-medium text-sm">
              {result.title}
            </div>
            {result.matchKind ? (
              <Badge variant="secondary">{result.matchKind}</Badge>
            ) : null}
          </div>
          <div className="mt-1 truncate text-muted-foreground text-xs">
            {result.path}
            {result.line ? `:${result.line}` : ""}
          </div>
          {result.detail ? (
            <div className="mt-1 text-muted-foreground text-xs">
              {result.detail}
            </div>
          ) : null}
        </div>
      ))}
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

function shortPath(value?: string): string {
  if (!value) {
    return "not available";
  }
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length <= 3 ? normalized : `.../${parts.slice(-3).join("/")}`;
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
