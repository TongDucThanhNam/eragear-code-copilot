import type {
  SupervisorRunClientUpdate,
  SupervisorRunDetailClientView,
} from "@eragear-code-copilot/shared";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { RunListGroup } from "./run-display";
import {
  getRunAttentionItems,
  getRunDisplayTitle,
  getRunProgress,
  getRunStatusPresentation,
  getRunWaitingRows,
  selectRunsForGroup,
} from "./run-display";
import { RunWorkspace, type RunWorkspaceActions } from "./run-workspace";
import { StatusBadge } from "./status-presentation";

export interface RunCenterProps {
  runs: readonly SupervisorRunClientUpdate[];
  isLoading: boolean;
  error: string | null;
  selectedRunId: string | null;
  onSelectRun: (runId: string | null) => void;
  detail: SupervisorRunDetailClientView | null;
  detailLoading: boolean;
  detailError: string | null;
  detailStale: boolean;
  actions: RunWorkspaceActions;
  onOpenWorkerChat: (chatId: string) => void;
  /** Injected clock key for tests; unused in production. */
  initialGroup?: RunListGroup;
}

const GROUPS: Array<{ id: RunListGroup; label: string }> = [
  { id: "attention", label: "Attention" },
  { id: "running", label: "Running" },
  { id: "waiting", label: "Waiting" },
  { id: "history", label: "History" },
];

/**
 * Run Center: a grouped, fully discoverable run list next to the full
 * main-area Run Workspace. All runs (every chat, every project) appear here;
 * the chat rail stays the scoped quick surface.
 */
export function RunCenter({
  runs,
  isLoading,
  error,
  selectedRunId,
  onSelectRun,
  detail,
  detailLoading,
  detailError,
  detailStale,
  actions,
  onOpenWorkerChat,
  initialGroup = "attention",
}: RunCenterProps) {
  const [group, setGroup] = useState<RunListGroup>(initialGroup);
  const selectedRun = runs.find((run) => run.runId === selectedRunId) ?? null;
  const grouped = selectRunsForGroup(runs, group);
  return (
    <div className="flex h-full min-h-0" data-testid="run-center">
      <aside
        aria-label="Supervised runs"
        className="flex w-full min-w-0 shrink-0 flex-col border-r md:w-80"
        data-testid="run-center-list"
      >
        <div className="shrink-0 px-3 pt-3">
          <h1 className="font-semibold text-sm">Run Center</h1>
          <p className="mt-0.5 text-muted-foreground text-xs">
            Every supervised run across your chats and projects.
          </p>
          <div
            aria-label="Run groups"
            className="mt-2 flex gap-1"
            role="tablist"
          >
            {GROUPS.map((entry) => {
              const count = selectRunsForGroup(runs, entry.id).length;
              return (
                <button
                  aria-selected={group === entry.id}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1 text-xs outline-none transition-colors",
                    group === entry.id
                      ? "bg-primary/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60"
                  )}
                  key={entry.id}
                  onClick={() => setGroup(entry.id)}
                  role="tab"
                  type="button"
                >
                  {entry.label}
                  <span className="ml-1 font-mono text-[10px]">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
        {error ? (
          <p className="mx-3 mt-2 rounded-md bg-destructive/10 px-2.5 py-2 text-destructive text-xs">
            {error}
          </p>
        ) : null}
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {isLoading ? (
            <p className="flex items-center gap-2 py-3 text-muted-foreground text-xs">
              <Loader2 className="size-3.5 animate-spin" /> Loading runs
            </p>
          ) : null}
          {!isLoading && grouped.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed px-3 py-4 text-center text-muted-foreground text-xs">
              {group === "attention"
                ? "Nothing needs your attention right now."
                : "No runs in this group."}
            </p>
          ) : null}
          <ul className="space-y-1.5">
            {grouped.map((run) => (
              <RunListItem
                isSelected={run.runId === selectedRunId}
                key={run.runId}
                onSelect={() => onSelectRun(run.runId)}
                run={run}
                runs={runs}
              />
            ))}
          </ul>
        </div>
      </aside>
      <div className="hidden min-w-0 flex-1 md:block">
        {selectedRun ? (
          <RunWorkspace
            actions={actions}
            allRuns={runs}
            detail={detail}
            detailError={detailError}
            detailLoading={detailLoading}
            detailStale={detailStale}
            onBack={() => onSelectRun(null)}
            onOpenWorkerChat={onOpenWorkerChat}
            run={selectedRun}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div>
              <p className="font-medium text-sm">Select a run</p>
              <p className="mt-1 text-muted-foreground text-xs">
                Pick a run from the list to open its full workspace: workflow,
                tasks, changes, evidence, and logs.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RunListItem({
  run,
  runs,
  isSelected,
  onSelect,
}: {
  run: SupervisorRunClientUpdate;
  runs: readonly SupervisorRunClientUpdate[];
  isSelected: boolean;
  onSelect: () => void;
}) {
  const status = getRunStatusPresentation(run);
  const progress = getRunProgress(run);
  const attentionCount = getRunAttentionItems(run).length;
  const waiting = getRunWaitingRows(run, runs);
  return (
    <li>
      <button
        aria-current={isSelected || undefined}
        className={cn(
          "w-full rounded-lg border px-2.5 py-2 text-left outline-none transition-colors",
          isSelected
            ? "border-primary/40 bg-primary/5"
            : "border-transparent hover:border-border hover:bg-muted/40"
        )}
        data-testid="run-center-item"
        onClick={onSelect}
        type="button"
      >
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate font-medium text-xs"
            title={run.runId}
          >
            {getRunDisplayTitle(run)}
          </span>
          <StatusBadge presentation={status} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          <span>
            {progress.completed}/{progress.total} tasks
          </span>
          {attentionCount > 0 ? (
            <span className="text-status-attention">
              {attentionCount} need attention
            </span>
          ) : null}
          {waiting.length > 0 && attentionCount === 0 ? (
            <span className="truncate">Waiting: {waiting[0]?.reason}</span>
          ) : null}
        </div>
      </button>
    </li>
  );
}
