// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import {
  AlertCircle,
  Clock3,
  GitBranch,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function ChangedFilesViewer() {
  const utils = trpc.useUtils();
  const summaryQuery = trpc.git.summary.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 15_000,
  });
  const summary = summaryQuery.data;
  const changedFiles = summary?.changedFiles ?? [];
  const checkpointsQuery = trpc.git.checkpoints.list.useQuery(undefined, {
    enabled: Boolean(summary?.isRepository),
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 15_000,
  });
  const createCheckpoint = trpc.git.checkpoints.create.useMutation({
    onSuccess: async () => {
      toast.success("Checkpoint captured");
      await Promise.all([
        utils.git.summary.invalidate(),
        utils.git.checkpoints.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const restoreCheckpoint = trpc.git.checkpoints.restore.useMutation({
    onSuccess: async (result) => {
      toast.success(
        result.safetyCheckpoint
          ? "Checkpoint restored; safety checkpoint captured"
          : "Checkpoint restored"
      );
      await Promise.all([
        utils.git.summary.invalidate(),
        utils.git.checkpoints.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  if (summaryQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground text-sm">
        Loading repository state...
      </div>
    );
  }

  if (summaryQuery.error) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="grid max-w-64 gap-3 text-center">
          <div className="mx-auto flex size-9 items-center justify-center rounded-md border bg-background text-muted-foreground">
            <AlertCircle className="size-4" />
          </div>
          <p className="text-muted-foreground text-sm leading-6">
            {summaryQuery.error.message}
          </p>
          <Button
            className="mx-auto"
            onClick={() => summaryQuery.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw className="mr-2 size-3.5" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground text-sm">
        No repository selected.
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="grid gap-3 p-3">
        <div className="grid gap-2 rounded-md border bg-background p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                <h3 className="truncate font-medium text-sm">
                  {summary.projectName}
                </h3>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant={summary.isRepository ? "default" : "outline"}>
                  {summary.isRepository ? "Git repo" : "No repo"}
                </Badge>
                {summary.branch ? (
                  <Badge variant="secondary">{summary.branch}</Badge>
                ) : null}
                {summary.head ? (
                  <Badge variant="outline">{summary.head}</Badge>
                ) : null}
              </div>
            </div>
            <Button
              aria-label="Refresh repository state"
              className="shrink-0"
              disabled={summaryQuery.isFetching}
              onClick={() => summaryQuery.refetch()}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <RefreshCw
                className={cn(
                  "size-4",
                  summaryQuery.isFetching ? "animate-spin" : ""
                )}
              />
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <Metric label="Changed" value={summary.totalChanged} />
            <Metric label="Staged" value={summary.stagedCount} />
            <Metric label="Unstaged" value={summary.unstagedCount} />
          </div>

          {summary.ahead > 0 || summary.behind > 0 ? (
            <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-muted-foreground text-xs">
              {summary.upstream ?? "Upstream"}: {summary.ahead} ahead,{" "}
              {summary.behind} behind
            </div>
          ) : null}

          {summary.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-destructive text-xs">
              {summary.error}
            </div>
          ) : null}
        </div>

        {changedFiles.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            Working tree clean.
          </div>
        ) : (
          <ul className="grid gap-1">
            {changedFiles.map((file) => (
              <li
                className="grid min-h-10 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-xs"
                key={`${file.status}:${file.path}`}
                title={file.path}
              >
                <StatusBadge status={file.status} />
                <div className="min-w-0">
                  <div className="truncate font-mono">{file.path}</div>
                  {file.oldPath ? (
                    <div className="truncate text-muted-foreground">
                      from {file.oldPath}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-2 rounded-md border bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Clock3 className="size-4 shrink-0 text-muted-foreground" />
              <h3 className="truncate font-medium text-sm">Checkpoints</h3>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                aria-label="Refresh checkpoints"
                disabled={checkpointsQuery.isFetching}
                onClick={() => checkpointsQuery.refetch()}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <RefreshCw
                  className={cn(
                    "size-4",
                    checkpointsQuery.isFetching ? "animate-spin" : ""
                  )}
                />
              </Button>
              <Button
                disabled={!summary.isRepository || createCheckpoint.isPending}
                onClick={() => createCheckpoint.mutate({})}
                size="sm"
                type="button"
                variant="outline"
              >
                <Save className="mr-2 size-3.5" />
                Create
              </Button>
            </div>
          </div>

          {checkpointsQuery.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-destructive text-xs">
              {checkpointsQuery.error.message}
            </div>
          ) : null}

          {summary.isRepository ? (
            checkpointsQuery.isLoading ? (
              <div className="rounded-md border border-dashed p-4 text-center text-muted-foreground text-sm">
                Loading checkpoints...
              </div>
            ) : (checkpointsQuery.data?.checkpoints.length ?? 0) === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center text-muted-foreground text-sm">
                No checkpoints yet.
              </div>
            ) : (
              <ul className="grid gap-1">
                {checkpointsQuery.data?.checkpoints.map((checkpoint) => (
                  <li
                    className="grid gap-2 rounded-md border bg-muted/20 p-2 text-xs"
                    key={checkpoint.id}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {checkpoint.name}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Badge
                            variant={
                              checkpoint.kind === "auto"
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {checkpoint.kind}
                          </Badge>
                          <Badge variant="outline">
                            {checkpoint.changedFiles.length} files
                          </Badge>
                          {checkpoint.gitHead ? (
                            <Badge variant="outline">
                              {checkpoint.gitHead.slice(0, 8)}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        disabled={
                          !checkpoint.canRestore || restoreCheckpoint.isPending
                        }
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Restore checkpoint "${checkpoint.name}"? A safety checkpoint will be captured first.`
                            )
                          ) {
                            return;
                          }
                          restoreCheckpoint.mutate({
                            checkpointId: checkpoint.id,
                          });
                        }}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        <RotateCcw className="mr-2 size-3.5" />
                        Restore
                      </Button>
                    </div>
                    <div className="truncate text-muted-foreground">
                      {formatCheckpointTime(checkpoint.createdAt)}
                      {checkpoint.turnId ? ` - ${checkpoint.turnId}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="rounded-md border border-dashed p-4 text-center text-muted-foreground text-sm">
              No Git repository.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2 py-1.5">
      <div className="font-semibold text-foreground">{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = getStatusLabel(status);
  const variant = status === "untracked" ? "outline" : "secondary";
  return (
    <Badge className="w-9 justify-center px-1 font-mono" variant={variant}>
      {label}
    </Badge>
  );
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "??";
    case "conflicted":
      return "!";
    default:
      return "?";
  }
}

function formatCheckpointTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
