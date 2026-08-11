"use client";

import {
  AlertCircle,
  ChevronDown,
  FileDiff,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

interface DiffViewProps {
  chatId?: string | null;
  projectId?: string | null;
}

type DiffScope = "working" | "branch" | "turn";

const SCOPES: Array<{ value: DiffScope; label: string }> = [
  { value: "working", label: "Working" },
  { value: "branch", label: "Branch" },
  { value: "turn", label: "Turn" },
];

function buildWorkflowInput(
  projectId?: string | null,
  chatId?: string | null
): { projectId?: string; sessionId?: string } {
  return {
    ...(projectId ? { projectId } : {}),
    ...(chatId ? { sessionId: chatId } : {}),
  };
}

export function DiffView({ chatId, projectId }: DiffViewProps) {
  const utils = trpc.useUtils();
  const [scope, setScope] = useState<DiffScope>("working");
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
  const [pendingRevertTurn, setPendingRevertTurn] = useState<number | null>(
    null
  );
  const turnInput = {
    sessionId: chatId ?? "inactive",
    ...(projectId ? { projectId } : {}),
  };
  const workingQuery = trpc.getGitDiff.useQuery(
    { chatId: chatId ?? "" },
    {
      enabled: Boolean(chatId) && scope === "working",
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 10_000,
    }
  );
  const branchQuery = trpc.git.actions.branchDiff.useQuery(
    buildWorkflowInput(projectId, chatId),
    {
      enabled: Boolean(projectId) && scope === "branch",
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 10_000,
    }
  );
  const turnListQuery = trpc.git.turnCheckpoints.list.useQuery(turnInput, {
    enabled: Boolean(chatId) && scope === "turn",
    refetchOnWindowFocus: false,
    retry: false,
  });
  const completedTurns = useMemo(
    () =>
      (turnListQuery.data?.checkpoints ?? []).filter(
        (checkpoint) => checkpoint.kind === "turn" && checkpoint.turnCount > 0
      ),
    [turnListQuery.data?.checkpoints]
  );

  useEffect(() => {
    if (
      selectedTurn !== null &&
      completedTurns.some((checkpoint) => checkpoint.turnCount === selectedTurn)
    ) {
      return;
    }
    setSelectedTurn(completedTurns.at(-1)?.turnCount ?? null);
  }, [completedTurns, selectedTurn]);

  const turnDiffQuery = trpc.git.turnCheckpoints.diff.useQuery(
    {
      ...turnInput,
      fromTurnCount: Math.max(0, (selectedTurn ?? 1) - 1),
      toTurnCount: selectedTurn ?? 1,
    },
    {
      enabled: Boolean(chatId) && scope === "turn" && selectedTurn !== null,
      refetchOnWindowFocus: false,
      retry: false,
    }
  );
  const revertMutation = trpc.git.turnCheckpoints.revert.useMutation({
    onSuccess: async (result) => {
      toast.success(
        `Reverted to turn ${result.checkpoint.turnCount}; conversation restored`
      );
      setPendingRevertTurn(null);
      await Promise.all([
        utils.git.turnCheckpoints.list.invalidate(turnInput),
        utils.git.turnCheckpoints.diff.invalidate(),
        utils.getGitDiff.invalidate(),
        utils.getSessionState.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const unifiedDiff =
    scope === "working"
      ? (workingQuery.data ?? "")
      : (branchQuery.data?.patch ?? "");
  const activeQuery = scope === "working" ? workingQuery : branchQuery;
  const turnTotals = turnDiffQuery.data?.files.reduce(
    (totals, file) => ({
      additions: totals.additions + file.additions,
      deletions: totals.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 }
  );
  const lineCount = unifiedDiff.trim() ? unifiedDiff.split("\n").length : 0;

  const refresh = async () => {
    if (scope === "working") {
      await workingQuery.refetch();
      return;
    }
    if (scope === "branch") {
      await branchQuery.refetch();
      return;
    }
    await Promise.all([turnListQuery.refetch(), turnDiffQuery.refetch()]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DiffToolbar
        completedTurns={completedTurns}
        isFetching={activeQuery.isFetching || turnListQuery.isFetching}
        isReverting={revertMutation.isPending}
        lineCount={lineCount}
        onRefresh={refresh}
        onRevert={setPendingRevertTurn}
        onScopeChange={setScope}
        onTurnChange={setSelectedTurn}
        scope={scope}
        selectedTurn={selectedTurn}
        turnFileCount={turnDiffQuery.data?.files.length ?? 0}
      />

      <div className="min-h-0 flex-1 overflow-auto bg-background">
        <DiffBody
          chatId={chatId}
          error={activeQuery.error?.message}
          isLoading={activeQuery.isLoading}
          scope={scope}
          turnAdditions={turnTotals?.additions ?? 0}
          turnDeletions={turnTotals?.deletions ?? 0}
          turnError={
            turnListQuery.error?.message ?? turnDiffQuery.error?.message
          }
          turnFiles={turnDiffQuery.data?.files ?? []}
          turnIsLoading={turnListQuery.isLoading || turnDiffQuery.isLoading}
          unifiedDiff={unifiedDiff}
        />
      </div>

      <RevertTurnDialog
        chatId={chatId}
        isPending={revertMutation.isPending}
        onClose={() => setPendingRevertTurn(null)}
        onConfirm={(turnCount) =>
          revertMutation.mutate({ ...turnInput, turnCount })
        }
        turnCount={pendingRevertTurn}
      />
    </div>
  );
}

function DiffToolbar({
  completedTurns,
  isFetching,
  isReverting,
  lineCount,
  onRefresh,
  onRevert,
  onScopeChange,
  onTurnChange,
  scope,
  selectedTurn,
  turnFileCount,
}: {
  completedTurns: Array<{
    ref: string;
    turnCount: number;
    turnId?: string;
  }>;
  isFetching: boolean;
  isReverting: boolean;
  lineCount: number;
  onRefresh: () => Promise<void>;
  onRevert: (turnCount: number | null) => void;
  onScopeChange: (scope: DiffScope) => void;
  onTurnChange: (turnCount: number) => void;
  scope: DiffScope;
  selectedTurn: number | null;
  turnFileCount: number;
}) {
  const countLabel =
    scope === "turn" ? `${turnFileCount} files` : `${lineCount} lines`;
  return (
    <div className="grid shrink-0 gap-2 border-b p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileDiff className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-sm">DiffView</span>
          <Badge variant="outline">{countLabel}</Badge>
        </div>
        <Button
          aria-label="Refresh diff"
          onClick={onRefresh}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
        </Button>
      </div>
      <div className="grid grid-cols-3 rounded-md border bg-muted/30 p-0.5">
        {SCOPES.map((item) => (
          <Button
            className="h-7 px-2 text-xs"
            key={item.value}
            onClick={() => onScopeChange(item.value)}
            type="button"
            variant={scope === item.value ? "secondary" : "ghost"}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {scope === "turn" && completedTurns.length > 0 ? (
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="h-7 min-w-0 flex-1 justify-between px-2 text-xs"
                type="button"
                variant="outline"
              >
                Turn {selectedTurn ?? "—"}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {[...completedTurns].reverse().map((checkpoint) => (
                <DropdownMenuItem
                  key={checkpoint.ref}
                  onSelect={() => onTurnChange(checkpoint.turnCount)}
                >
                  Turn {checkpoint.turnCount}
                  {checkpoint.turnId ? (
                    <span className="ml-auto max-w-28 truncate text-muted-foreground text-xs">
                      {checkpoint.turnId}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            aria-label="Revert to selected turn"
            className="h-7 px-2 text-xs"
            disabled={selectedTurn === null || isReverting}
            onClick={() => onRevert(selectedTurn)}
            type="button"
            variant="outline"
          >
            <RotateCcw className="size-3.5" />
            Revert
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DiffBody({
  chatId,
  error,
  isLoading,
  scope,
  turnAdditions,
  turnDeletions,
  turnError,
  turnFiles,
  turnIsLoading,
  unifiedDiff,
}: {
  chatId?: string | null;
  error?: string;
  isLoading: boolean;
  scope: DiffScope;
  turnAdditions: number;
  turnDeletions: number;
  turnError?: string;
  turnFiles: Array<{
    path: string;
    oldPath?: string;
    kind: string;
    additions: number;
    deletions: number;
  }>;
  turnIsLoading: boolean;
  unifiedDiff: string;
}) {
  if (!chatId) {
    return <DiffEmptyState detail="No active chat." />;
  }
  if (scope === "turn") {
    return (
      <TurnDiffContent
        additions={turnAdditions}
        deletions={turnDeletions}
        error={turnError}
        files={turnFiles}
        isLoading={turnIsLoading}
      />
    );
  }
  if (isLoading) {
    return (
      <DiffEmptyState
        detail="Loading diff..."
        iconClassName="animate-pulse text-muted-foreground"
      />
    );
  }
  if (error) {
    return (
      <DiffEmptyState
        detail={error}
        icon={AlertCircle}
        iconClassName="text-destructive"
      />
    );
  }
  if (!unifiedDiff.trim()) {
    const detail =
      scope === "working"
        ? "Working tree clean."
        : "No committed changes against the default branch.";
    return <DiffEmptyState detail={detail} />;
  }
  return <UnifiedDiff patch={unifiedDiff} />;
}

function RevertTurnDialog({
  chatId,
  isPending,
  onClose,
  onConfirm,
  turnCount,
}: {
  chatId?: string | null;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (turnCount: number) => void;
  turnCount: number | null;
}) {
  const confirm = () => {
    if (turnCount !== null && chatId) {
      onConfirm(turnCount);
    }
  };
  return (
    <Dialog
      onOpenChange={(open) => !open && onClose()}
      open={turnCount !== null}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Revert to turn {turnCount}</DialogTitle>
          <DialogDescription>
            The working tree and conversation will roll back together. A safety
            checkpoint is created before files are restored.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={turnCount === null || isPending}
            onClick={confirm}
            type="button"
            variant="destructive"
          >
            Revert files and conversation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TurnDiffContent({
  additions,
  deletions,
  error,
  files,
  isLoading,
}: {
  additions: number;
  deletions: number;
  error?: string;
  files: Array<{
    path: string;
    oldPath?: string;
    kind: string;
    additions: number;
    deletions: number;
  }>;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <DiffEmptyState detail="Loading turn diff..." />;
  }
  if (error) {
    return (
      <DiffEmptyState
        detail={error}
        icon={AlertCircle}
        iconClassName="text-destructive"
      />
    );
  }
  if (files.length === 0) {
    return <DiffEmptyState detail="This turn did not change files." />;
  }
  return (
    <div className="grid gap-2 p-3">
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="secondary">{files.length} files</Badge>
        <span className="font-medium text-emerald-600">+{additions}</span>
        <span className="font-medium text-red-600">−{deletions}</span>
      </div>
      {files.map((file) => (
        <div className="grid gap-1 rounded-md border p-2" key={file.path}>
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 break-all font-mono text-xs">
              {file.path}
            </span>
            <Badge className="shrink-0" variant="outline">
              {file.kind}
            </Badge>
          </div>
          {file.oldPath ? (
            <span className="break-all text-muted-foreground text-xs">
              from {file.oldPath}
            </span>
          ) : null}
          <div className="flex gap-2 text-xs">
            <span className="text-emerald-600">+{file.additions}</span>
            <span className="text-red-600">−{file.deletions}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function UnifiedDiff({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  return (
    <pre className="min-w-max p-3 font-mono text-[11px] leading-5">
      {lines.map((line, index) => (
        <div
          className={cn(
            "grid grid-cols-[3rem_minmax(0,1fr)] gap-3 border-l-2 px-2",
            getDiffLineClass(line)
          )}
          key={`${index}:${line.slice(0, 32)}`}
        >
          <span className="select-none text-right text-muted-foreground">
            {index + 1}
          </span>
          <code className="whitespace-pre">{line || " "}</code>
        </div>
      ))}
    </pre>
  );
}

function DiffEmptyState({
  detail,
  icon: Icon = FileDiff,
  iconClassName,
}: {
  detail: string;
  icon?: ComponentType<{ className?: string }>;
  iconClassName?: string;
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-6 text-center">
      <div className="grid max-w-64 gap-3">
        <div className="mx-auto flex size-9 items-center justify-center border bg-muted/20">
          <Icon className={cn("size-4", iconClassName)} />
        </div>
        <p className="text-muted-foreground text-sm leading-6">{detail}</p>
      </div>
    </div>
  );
}

function getDiffLineClass(line: string) {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) {
    return "border-border bg-muted/40 text-foreground";
  }
  if (line.startsWith("@@")) {
    return "border-ring bg-muted/60 text-foreground";
  }
  if (line.startsWith("+")) {
    return "border-chart-2/50 bg-chart-2/10 text-chart-2";
  }
  if (line.startsWith("-")) {
    return "border-destructive/50 bg-destructive/10 text-destructive";
  }
  if (line.startsWith("diff --git")) {
    return "border-border bg-muted/30 font-semibold text-foreground";
  }
  return "border-transparent text-muted-foreground";
}
