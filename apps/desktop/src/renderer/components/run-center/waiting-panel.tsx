import { cn } from "@/lib/utils";
import type { RunWaitingCause, RunWaitingRow } from "./run-display";
import { getWaitTimeView } from "./run-display";
import { useApproximateNow, WaitTimeText } from "./status-presentation";

export const WAITING_CAUSE_LABEL: Record<RunWaitingCause, string> = {
  quota: "Quota",
  rate_limit: "Rate limit",
  auth: "Sign-in required",
  transport: "Connection",
  session_fatal: "Session error",
  unknown_provider: "Unknown provider",
  dependency: "Dependency",
  repository: "Repository busy",
  paused: "Paused",
};

export interface RunWaitingListProps {
  rows: RunWaitingRow[];
  /** Injected clock for tests; display-only in production. */
  nowMs?: number;
  onOpenTask?: (taskId: string) => void;
  className?: string;
}

/**
 * Honest waiting list: cause, owner, reason, and the next known time when the
 * provider reports one ("quota resets …", "retry in ~2m"). No countdown
 * claims, no renderer-side scheduling — the 30s clock only refreshes text.
 */
export function RunWaitingList({
  rows,
  nowMs,
  onOpenTask,
  className,
}: RunWaitingListProps) {
  const now = useApproximateNow(rows.length > 0, nowMs);
  if (rows.length === 0) {
    return null;
  }
  return (
    <ul className={cn("space-y-1.5", className)} data-testid="run-waiting-list">
      {rows.map((row) => {
        const times = getWaitTimeView(row, now);
        const interactive = Boolean(row.taskId && onOpenTask);
        const body = (
          <>
            <span
              className={cn(
                "shrink-0 whitespace-nowrap rounded-sm border px-1.5 py-px text-[10px]",
                row.waitingOnHuman
                  ? "border-status-attention/40 bg-status-attention/10 text-status-attention"
                  : "border-border bg-muted/60 text-muted-foreground"
              )}
            >
              {WAITING_CAUSE_LABEL[row.cause]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-xs">
                {row.reason}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {row.ownerLabel}
                {row.waitingOnHuman ? " — waiting on you" : ""}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              {times.retry ? (
                <WaitTimeText label="retry" time={times.retry} />
              ) : null}
              {times.reset ? (
                <WaitTimeText label="resets" time={times.reset} />
              ) : null}
              {times.retry || times.reset ? null : (
                <span className="text-[11px] text-muted-foreground italic">
                  {row.waitingOnHuman ? "needs your input" : "no time estimate"}
                </span>
              )}
            </span>
          </>
        );
        return (
          <li key={row.id}>
            {interactive && row.taskId ? (
              <button
                className="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left outline-none hover:border-border hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40"
                data-cause={row.cause}
                data-testid="run-waiting-row"
                onClick={() => onOpenTask?.(row.taskId as string)}
                type="button"
              >
                {body}
              </button>
            ) : (
              <div
                className="flex items-center gap-2 rounded-md px-2 py-1.5"
                data-cause={row.cause}
                data-testid="run-waiting-row"
              >
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
