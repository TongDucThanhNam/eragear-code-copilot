import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CirclePause,
  CirclePlay,
  ExternalLink,
  Loader2,
  Network,
  RotateCcw,
  Square,
} from "lucide-react";
import { useState } from "react";
import {
  describeRunVerificationSummary,
  getRunAttentionItems,
  getRunCurrentActivity,
  getRunDisplayTitle,
  getRunProgress,
  getRunStatusPresentation,
  getRunVerificationSummary,
  getRunWaitingRows,
  getTaskStatusPresentation,
  isTerminalSupervisosRun,
  type RunAttentionAction,
  type RunAttentionItem,
  selectRunsForGroup,
} from "@/components/run-center/run-display";
import {
  AgentPill,
  compactAttemptPresentation,
  STATUS_TONE_TEXT,
  StatusBadge,
  StatusIcon,
  supervisosActionVariant,
  supervisosAuthorityChip,
} from "@/components/run-center/status-presentation";
import { RunWaitingList } from "@/components/run-center/waiting-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSupervisorRunsCore } from "@/hooks/use-supervisor-runs";

type RunsController = ReturnType<typeof useSupervisorRunsCore>;

export function SupervisosRuns({ chatId }: { chatId: string }) {
  const controller = useSupervisorRunsCore();
  const navigate = useNavigate();
  return (
    <SupervisosRunsView
      {...controller}
      chatId={chatId}
      onOpenRunCenter={() => navigate({ to: "/runs", search: {} })}
      onOpenWorker={(workerChatId) =>
        navigate({ to: "/", search: { chatId: workerChatId } })
      }
      onOpenWorkspace={(runId) => navigate({ to: "/runs", search: { runId } })}
    />
  );
}

export interface SupervisosRunsViewProps
  extends Omit<RunsController, "updateCachedRun"> {
  chatId: string;
  onOpenWorker: (chatId: string) => void;
  onOpenWorkspace?: (runId: string) => void;
  onOpenRunCenter?: () => void;
}

export function SupervisosRunsView(props: SupervisosRunsViewProps) {
  const [intent, setIntent] = useState("");
  const [showAllRuns, setShowAllRuns] = useState(false);
  const scopedRuns = props.runs.filter(
    (run) => !run.originatingChatId || run.originatingChatId === props.chatId
  );
  const projectRuns = props.runs.filter(
    (run) => run.originatingChatId && run.originatingChatId !== props.chatId
  );
  const visibleRuns = showAllRuns ? props.runs : scopedRuns;
  const attentionRuns = selectRunsForGroup(visibleRuns, "attention");

  const submit = async () => {
    const value = intent.trim();
    if (!value) {
      return;
    }
    await props.start(value);
    setIntent("");
  };
  return (
    <section aria-label="Supervised runs" className="border-t px-3 py-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Network className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="font-medium text-xs leading-tight">Runs</h2>
            <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
              Parallel workers with dependency gates.
            </p>
          </div>
        </div>
        <Badge variant="outline">{visibleRuns.length}</Badge>
      </div>

      {props.error ? (
        <div className="mb-2 flex gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-destructive text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="leading-relaxed">{props.error}</span>
        </div>
      ) : null}

      <div className="mb-3 flex gap-1.5">
        <Input
          aria-label="Supervised run objective"
          disabled={!props.canStart || props.isPending}
          onChange={(event) => setIntent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit().catch(() => undefined);
            }
          }}
          placeholder={
            props.canStart
              ? "Describe a multi-worker run"
              : "Select a project first"
          }
          value={intent}
        />
        <Button
          aria-label="Start supervised run"
          disabled={!props.canStart || props.isPending || !intent.trim()}
          onClick={() => {
            return submit().catch(() => undefined);
          }}
          size="sm"
          type="button"
        >
          {props.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            "Start"
          )}
        </Button>
      </div>

      {props.isLoading ? (
        <div className="flex items-center gap-2 py-3 text-muted-foreground text-xs">
          <Loader2 className="size-3.5 animate-spin" /> Loading runs
        </div>
      ) : null}
      {!props.isLoading && props.runs.length === 0 ? (
        <div className="rounded-md bg-muted/60 px-3 py-3 text-center">
          <Network className="mx-auto size-4 text-muted-foreground" />
          <p className="mt-1.5 font-medium text-xs">No supervised run yet</p>
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
            Start with a bounded objective; Supervisos will plan the worker
            graph.
          </p>
        </div>
      ) : null}

      {attentionRuns.length > 0 ? (
        <div
          className="mb-2 rounded-md border border-status-attention/30 bg-status-attention/5 px-2.5 py-2"
          data-testid="runs-attention-summary"
        >
          <p className="font-medium text-status-attention text-xs">
            {attentionRuns.length === 1
              ? "1 run needs your attention"
              : `${attentionRuns.length} runs need your attention`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {attentionRuns.slice(0, 3).map((run) => {
              const first = getRunAttentionItems(run)[0];
              return (
                <li
                  className="truncate text-[11px] text-muted-foreground"
                  key={run.runId}
                >
                  {getRunDisplayTitle(run)} — {first?.title ?? run.status}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* minmax(0,1fr) keeps the auto column from sizing to the min-content
          of nowrap `truncate` lines, which would push authority actions
          outside narrow chat containers. */}
      <div
        className="grid max-h-72 grid-cols-[minmax(0,1fr)] gap-2 overflow-y-auto"
        data-testid="chat-run-list"
      >
        {visibleRuns.slice(0, 3).map((run) => (
          <RunCard controller={props} key={run.runId} run={run} />
        ))}
      </div>

      {projectRuns.length > 0 ? (
        <button
          className="mt-2 text-muted-foreground text-xs underline-offset-2 hover:underline"
          data-testid="runs-toggle-all"
          onClick={() => setShowAllRuns((current) => !current)}
          type="button"
        >
          {showAllRuns
            ? "Show this chat only"
            : `Show all runs (${projectRuns.length} from other chats)`}
        </button>
      ) : null}
      {props.onOpenRunCenter ? (
        <button
          className="mt-1 block text-muted-foreground text-xs underline-offset-2 hover:underline"
          data-testid="runs-open-center"
          onClick={props.onOpenRunCenter}
          type="button"
        >
          Open Run Center
        </button>
      ) : null}
    </section>
  );
}

const TASK_STATUS_TEXT_CLASS: Record<string, string> = {
  attention: "text-status-attention",
  failed: "text-status-failed",
  success: "text-status-success",
};

function taskStatusTextClass(tone: string): string {
  return TASK_STATUS_TEXT_CLASS[tone] ?? "text-muted-foreground";
}

function RunCard({
  run,
  controller,
}: {
  run: SupervisorRunClientUpdate;
  controller: SupervisosRunsViewProps;
}) {
  const status = getRunStatusPresentation(run);
  const progress = getRunProgress(run);
  const activity = getRunCurrentActivity(run);
  const attention = getRunAttentionItems(run);
  const waiting = getRunWaitingRows(run, [run]);
  const title = getRunDisplayTitle(run);

  return (
    <article
      className="rounded-md bg-muted/50 px-2.5 py-2.5"
      data-testid="chat-run-card"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-xs" title={run.runId}>
            {title}
          </div>
          <div className="mt-0.5 text-muted-foreground text-xs">
            {progress.completed}/{progress.total} tasks · revision{" "}
            {run.revision}
          </div>
        </div>
        <StatusBadge presentation={status} />
      </div>

      {activity ? (
        <p
          className="mt-1.5 truncate text-muted-foreground text-xs"
          title={activity.headline}
        >
          {activity.headline}
        </p>
      ) : null}

      {attention.length > 0 ? (
        <ul className="mt-1.5 space-y-1.5" data-testid="chat-run-attention">
          {attention.map((item) => (
            <ChatAttentionLine
              controller={controller}
              item={item}
              key={item.id}
              run={run}
            />
          ))}
        </ul>
      ) : null}

      {waiting.length > 0 ? (
        <div className="mt-1.5">
          <RunWaitingList rows={waiting.slice(0, 2)} />
        </div>
      ) : null}

      <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1.5">
        {run.tasks.map((task) => {
          const taskStatus = getTaskStatusPresentation(task);
          const retryable =
            (task.status === "failed" || task.status === "needs_user") &&
            (!run.limits ||
              task.attempts.length < run.limits.maxAttemptsPerTask);
          const budgetSpent =
            (task.status === "failed" || task.status === "needs_user") &&
            Boolean(
              run.limits &&
                task.attempts.length >= run.limits.maxAttemptsPerTask
            );
          return (
            <div
              className="rounded-sm bg-background/70 px-2 py-1.5"
              data-testid="chat-run-task"
              key={task.taskId}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-xs">
                    {task.title}
                  </div>
                  <div className="mt-0.5 text-muted-foreground text-xs">
                    {task.role} · {task.executionMode.replace("_", "-")}
                    {task.dependencies.length > 0
                      ? ` · waits for ${task.dependencies.length}`
                      : ""}
                    {task.preferredModelId ? ` · ${task.preferredModelId}` : ""}
                  </div>
                </div>
                <span
                  className={`shrink-0 text-xs ${taskStatusTextClass(taskStatus.tone)}`}
                >
                  {taskStatus.label}
                </span>
              </div>
              {task.attempts.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {task.attempts.map((attempt) => (
                    <div className="w-36" key={attempt.attemptId}>
                      <AgentPill
                        chatId={attempt.chatId}
                        identitySeed={attempt.agentId || attempt.attemptId}
                        label={attempt.agentId}
                        onOpen={
                          attempt.chatId
                            ? (chatId) => controller.onOpenWorker(chatId)
                            : undefined
                        }
                        status={compactAttemptPresentation(attempt)}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
              {retryable ? (
                <Button
                  className="mt-1.5 h-6 gap-1 px-1.5 text-xs"
                  disabled={controller.isPending}
                  onClick={() => {
                    return controller
                      .retryTask(run.runId, task.taskId)
                      .catch(() => undefined);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RotateCcw className="size-3" /> Retry
                </Button>
              ) : null}
              {budgetSpent ? (
                <div className="mt-1.5 text-muted-foreground text-xs">
                  Attempt budget exhausted · replan required
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {run.status === "completed" ? (
        <CompletedVerificationNote run={run} />
      ) : null}

      {isTerminalSupervisosRun(run) ? null : (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {runAuthorityActions(run, controller).map((action) => (
            <Button
              className="h-6 gap-1 px-1.5 text-xs"
              disabled={controller.isPending}
              key={action.label}
              onClick={() => {
                return action.onClick().catch(() => undefined);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <action.icon className="size-3 text-muted-foreground" />{" "}
              {action.label}
            </Button>
          ))}
          {controller.onOpenWorkspace ? (
            <Button
              className="ml-auto h-6 gap-1 px-1.5 text-xs"
              data-testid="chat-run-open-workspace"
              onClick={() => controller.onOpenWorkspace?.(run.runId)}
              size="sm"
              type="button"
              variant="outline"
            >
              <ExternalLink className="size-3 text-muted-foreground" />{" "}
              Workspace
            </Button>
          ) : null}
        </div>
      )}
    </article>
  );
}

/**
 * Honest completed-run verification note. Machine checks, user-accepted or
 * waived criteria, and missing evidence stay distinct facts — an empty check
 * list never claims a passing aggregate verification.
 */
function CompletedVerificationNote({
  run,
}: {
  run: SupervisorRunClientUpdate;
}) {
  const summary = getRunVerificationSummary(run);
  const described = describeRunVerificationSummary(summary);
  return (
    <div
      className="mt-2 grid gap-0.5 text-xs"
      data-testid="chat-run-verification"
      data-verification-state={summary.state}
    >
      <div className="flex items-center gap-1.5">
        <StatusIcon
          className="size-3.5 shrink-0"
          presentation={{
            kind: "needs_user",
            label: described.label,
            tone: described.tone,
          }}
        />
        <span className={STATUS_TONE_TEXT[described.tone]}>
          {described.label}
        </span>
      </div>
      {summary.userResolvedCriteria > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {summary.userResolvedCriteria} criterion
          {summary.userResolvedCriteria === 1 ? "" : "a"} accepted or waived by
          your review — user authority, not machine evidence
        </p>
      ) : null}
    </div>
  );
}

function runAuthorityActions(
  run: SupervisorRunClientUpdate,
  controller: SupervisosRunsViewProps
): Array<{
  icon: typeof CirclePause;
  label: string;
  onClick: () => Promise<unknown>;
}> {
  const actions: Array<{
    icon: typeof CirclePause;
    label: string;
    onClick: () => Promise<unknown>;
  }> = [];
  if (run.status === "paused") {
    actions.push({
      icon: CirclePlay,
      label: "Resume",
      onClick: () => controller.resume(run.runId),
    });
  }
  if (run.status === "running" || run.status === "queued") {
    actions.push({
      icon: CirclePause,
      label: "Pause",
      onClick: () => controller.pause(run.runId),
    });
  }
  if (run.status === "needs_user") {
    actions.push({
      icon: RotateCcw,
      label: "Replan",
      onClick: () => controller.replan(run.runId),
    });
  }
  if (!isTerminalSupervisosRun(run)) {
    actions.push({
      icon: Square,
      label: "Cancel",
      onClick: () => controller.cancel(run.runId),
    });
  }
  return actions;
}

function draftPlaceholderOf(item: RunAttentionItem): string {
  if (item.decisionKind === "goal_criteria_acceptance") {
    return "Review note; required when waiving";
  }
  if (item.kind === "decision") {
    return "Answer this question";
  }
  return "What should change in this plan?";
}

function draftInputLabelOf(item: RunAttentionItem): string {
  return item.kind === "decision"
    ? "Decision answer"
    : "Requested plan changes";
}

function applyChatAttentionAction(
  controller: SupervisosRunsViewProps,
  run: SupervisorRunClientUpdate,
  item: RunAttentionItem,
  action: RunAttentionAction,
  draft: string,
  onConsumed: () => void
) {
  switch (action.id) {
    case "approve":
      controller.approvePlan(run).catch(() => undefined);
      break;
    case "request-changes":
      if (draft) {
        controller.requestPlanChanges(run, draft).catch(() => undefined);
        onConsumed();
      }
      break;
    case "approve-gate":
      if (item.gateId) {
        controller.approveGate(run.runId, item.gateId).catch(() => undefined);
      }
      break;
    case "reject-gate":
      if (item.gateId) {
        controller.rejectGate(run.runId, item.gateId).catch(() => undefined);
      }
      break;
    case "accept":
      if (item.decisionId) {
        controller
          .answerDecision(
            run.runId,
            item.decisionId,
            draft || "Accepted after explicit user review.",
            run.revision,
            "accept"
          )
          .catch(() => undefined);
        onConsumed();
      }
      break;
    case "waive":
      if (item.decisionId && draft) {
        controller
          .answerDecision(
            run.runId,
            item.decisionId,
            draft,
            run.revision,
            "waive"
          )
          .catch(() => undefined);
        onConsumed();
      }
      break;
    case "answer":
      if (item.decisionId && draft) {
        controller
          .answerDecision(run.runId, item.decisionId, draft, run.revision)
          .catch(() => undefined);
        onConsumed();
      }
      break;
    case "retry-cancel":
      controller.cancel(run.runId).catch(() => undefined);
      break;
    case "replan":
      controller.replan(run.runId).catch(() => undefined);
      break;
    case "open-chat":
      if (item.chatId) {
        controller.onOpenWorker(item.chatId);
      }
      break;
    default:
      break;
  }
}

/**
 * One attention line with its own local draft. Free-text authorities
 * (request changes, decision answers) use an inline input — Electron
 * renderers have no window.prompt, and the note is part of the authority
 * action, not an afterthought.
 */
function ChatAttentionLine({
  item,
  run,
  controller,
}: {
  item: RunAttentionItem;
  run: SupervisorRunClientUpdate;
  controller: SupervisosRunsViewProps;
}) {
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();
  const chip = supervisosAuthorityChip(item.authority);
  const needsDraft =
    item.kind === "decision" ||
    (item.kind === "plan_approval" &&
      item.actions.some((action) => action.id === "request-changes"));

  const act = (action: RunAttentionAction) =>
    applyChatAttentionAction(controller, run, item, action, trimmed, () =>
      setDraft("")
    );

  const actionDisabled = (action: RunAttentionAction): boolean => {
    if (controller.isPending) {
      return true;
    }
    if (action.disabledReason) {
      return true;
    }
    if (
      needsDraft &&
      ["request-changes", "waive", "answer"].includes(action.id)
    ) {
      return !trimmed;
    }
    return false;
  };

  return (
    <li
      className="rounded-sm bg-background/70 px-2 py-1.5"
      data-authority={item.authority}
      data-kind={item.kind}
      data-testid="chat-run-attention-item"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`shrink-0 whitespace-nowrap rounded-full border px-1.5 py-px text-[10px] ${chip.className}`}
        >
          {chip.label}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-xs"
          title={item.detail ?? item.title}
        >
          {item.title}
        </span>
      </div>
      {needsDraft || item.actions.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {needsDraft ? (
            <Input
              aria-label={draftInputLabelOf(item)}
              className="h-7 min-w-40 flex-1 text-xs"
              disabled={controller.isPending}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={draftPlaceholderOf(item)}
              value={draft}
            />
          ) : null}
          {item.actions.map((action) => (
            <Button
              className="h-7 gap-1 px-2 text-xs"
              disabled={actionDisabled(action)}
              key={action.id}
              onClick={() => act(action)}
              size="sm"
              title={action.disabledReason}
              type="button"
              variant={supervisosActionVariant(action.emphasis)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
      {item.authority === "machine" ? (
        <p className="mt-1 text-[11px] text-muted-foreground italic">
          Decided by the workflow kernel — not by user approval.
        </p>
      ) : null}
    </li>
  );
}
