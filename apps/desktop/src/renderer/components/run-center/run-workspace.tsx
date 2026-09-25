import type {
  SupervisorRunClientUpdate,
  SupervisorRunDetailClientView,
} from "@eragear-code-copilot/shared";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { LifecycleSpine } from "./lifecycle-spine";
import { NeedsAttentionPanel } from "./needs-attention-panel";
import {
  getRunAttentionItems,
  getRunCurrentActivity,
  getRunDisplayTitle,
  getRunGoalStatement,
  getRunProgress,
  getRunStatusPresentation,
  getRunWaitingRows,
  getTaskStatusPresentation,
  isTerminalSupervisosRun,
  type RunAttentionAction,
  type RunAttentionItem,
} from "./run-display";
import { AgentPill, DetailRow, StatusBadge } from "./status-presentation";
import { buildSupervisorRunTimeline } from "./timeline-model";
import { RunWaitingList } from "./waiting-panel";
import { SupervisorWorkflowTimeline } from "./workflow-timeline";

export interface RunWorkspaceActions {
  isPending: boolean;
  pause(runId: string): Promise<unknown>;
  resume(runId: string): Promise<unknown>;
  cancel(runId: string): Promise<unknown>;
  replan(runId: string): Promise<unknown>;
  retryTask(runId: string, taskId: string): Promise<unknown>;
  approvePlan(run: SupervisorRunClientUpdate): Promise<unknown>;
  requestPlanChanges(
    run: SupervisorRunClientUpdate,
    note: string
  ): Promise<unknown>;
  answerDecision(
    runId: string,
    decisionId: string,
    answer: string,
    expectedRevision: number,
    criterionResolution?: "accept" | "waive"
  ): Promise<unknown>;
  approveGate(runId: string, gateId: string): Promise<unknown>;
  rejectGate(runId: string, gateId: string): Promise<unknown>;
  setPriority(
    runId: string,
    priority: SupervisorRunClientUpdate["priority"],
    expectedRevision: number
  ): Promise<unknown>;
}

export interface RunWorkspaceProps {
  run: SupervisorRunClientUpdate;
  /** Deep projection; may be null while loading or when the run vanished. */
  detail: SupervisorRunDetailClientView | null;
  detailLoading: boolean;
  detailError: string | null;
  detailStale: boolean;
  allRuns: readonly SupervisorRunClientUpdate[];
  actions: RunWorkspaceActions;
  onOpenWorkerChat: (chatId: string) => void;
  onBack: () => void;
  /** Initial view; deep links and tests can open a specific tab directly. */
  initialTab?: string;
}

const WORKSPACE_TABS = [
  { id: "overview", label: "Overview" },
  { id: "workflow", label: "Workflow" },
  { id: "tasks", label: "Tasks" },
  { id: "changes", label: "Changes" },
  { id: "evidence", label: "Evidence" },
  { id: "logs", label: "Logs" },
] as const;

function applyRunAttentionAction(
  actions: RunWorkspaceActions,
  run: SupervisorRunClientUpdate,
  onOpenWorkerChat: (chatId: string) => void,
  item: RunAttentionItem,
  action: RunAttentionAction,
  draft: string
) {
  switch (action.id) {
    case "approve":
      actions.approvePlan(run).catch(() => undefined);
      break;
    case "request-changes":
      if (draft) {
        actions.requestPlanChanges(run, draft).catch(() => undefined);
      }
      break;
    case "approve-gate":
      if (item.gateId) {
        actions.approveGate(run.runId, item.gateId).catch(() => undefined);
      }
      break;
    case "reject-gate":
      if (item.gateId) {
        actions.rejectGate(run.runId, item.gateId).catch(() => undefined);
      }
      break;
    case "accept":
      if (item.decisionId) {
        actions
          .answerDecision(
            run.runId,
            item.decisionId,
            draft || "Accepted after explicit user review.",
            run.revision,
            "accept"
          )
          .catch(() => undefined);
      }
      break;
    case "waive":
      if (item.decisionId && draft) {
        actions
          .answerDecision(
            run.runId,
            item.decisionId,
            draft,
            run.revision,
            "waive"
          )
          .catch(() => undefined);
      }
      break;
    case "answer":
      if (item.decisionId && draft) {
        actions
          .answerDecision(run.runId, item.decisionId, draft, run.revision)
          .catch(() => undefined);
      }
      break;
    case "retry-cancel":
      actions.cancel(run.runId).catch(() => undefined);
      break;
    case "replan":
      actions.replan(run.runId).catch(() => undefined);
      break;
    case "open-chat":
      if (item.chatId) {
        onOpenWorkerChat(item.chatId);
      }
      break;
    default:
      break;
  }
}

export function RunWorkspace({
  run,
  detail,
  detailLoading,
  detailError,
  detailStale,
  allRuns,
  actions,
  onOpenWorkerChat,
  onBack,
  initialTab = "overview",
}: RunWorkspaceProps) {
  const [tab, setTab] = useState<string>(initialTab);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(
    null
  );
  const status = getRunStatusPresentation(run);
  const title = getRunDisplayTitle(run);
  const waiting = getRunWaitingRows(run, allRuns);
  const attention = getRunAttentionItems(run);
  const terminal = isTerminalSupervisosRun(run);

  const handleAttentionAction = (
    item: RunAttentionItem,
    action: RunAttentionAction,
    draft: string
  ) =>
    applyRunAttentionAction(
      actions,
      run,
      onOpenWorkerChat,
      item,
      action,
      draft
    );

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-run-id={run.runId}
      data-testid="run-workspace"
    >
      <header className="shrink-0 border-b bg-background/80 px-4 pt-3 pb-3 backdrop-blur">
        <div className="flex items-start gap-2">
          <Button
            aria-label="Back to run list"
            className="size-7 shrink-0"
            onClick={onBack}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-semibold text-sm" title={title}>
                {title}
              </h1>
              <StatusBadge presentation={status} />
            </div>
            <p
              className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
              title={run.runId}
            >
              {run.runId} · revision {run.revision}
              {detail
                ? ` · phase ${detail.phase} · ${detail.desiredState}`
                : ""}
              {detail?.outcome ? ` · ${detail.outcome}` : ""}
            </p>
          </div>
          {terminal ? null : (
            <div className="flex shrink-0 flex-wrap gap-1">
              {run.status === "paused" ? (
                <Button
                  disabled={actions.isPending}
                  onClick={() =>
                    actions.resume(run.runId).catch(() => undefined)
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Resume
                </Button>
              ) : null}
              {run.status === "running" || run.status === "queued" ? (
                <Button
                  disabled={actions.isPending}
                  onClick={() =>
                    actions.pause(run.runId).catch(() => undefined)
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Pause
                </Button>
              ) : null}
              <Button
                disabled={actions.isPending}
                onClick={() => actions.cancel(run.runId).catch(() => undefined)}
                size="sm"
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
        {attention.length > 0 ? (
          <p
            className="mt-2 truncate rounded-sm border border-status-attention/30 bg-status-attention/5 px-2 py-1 text-status-attention text-xs"
            data-testid="run-workspace-attention-banner"
          >
            {attention.length} item{attention.length === 1 ? "" : "s"} need your
            attention — {attention[0]?.title}
          </p>
        ) : null}
        {waiting.length > 0 && attention.length === 0 ? (
          <p className="mt-2 truncate rounded-sm border px-2 py-1 text-muted-foreground text-xs">
            Waiting: {waiting[0]?.reason}
          </p>
        ) : null}
      </header>

      <Tabs className="min-h-0 flex-1" onValueChange={setTab} value={tab}>
        <TabsList
          aria-label="Run workspace views"
          className="mx-4 mt-2 shrink-0"
          variant="line"
        >
          {WORKSPACE_TABS.map((view) => (
            <TabsTrigger key={view.id} value={view.id}>
              {view.label}
              {view.id === "overview" && attention.length > 0 ? (
                <span className="ml-1 rounded-full bg-status-attention/15 px-1 font-mono text-[10px] text-status-attention">
                  {attention.length}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <TabsContent value="overview">
            <OverviewView
              actions={actions}
              attention={attention}
              detail={detail}
              onAttentionAction={handleAttentionAction}
              run={run}
              waiting={waiting}
            />
          </TabsContent>
          <TabsContent value="workflow">
            <WorkflowView
              detail={detail}
              onOpenWorkerChat={onOpenWorkerChat}
              onSelectStation={setSelectedStationId}
              run={run}
              selectedStationId={selectedStationId}
            />
          </TabsContent>
          <TabsContent value="tasks">
            <TasksView
              actions={actions}
              detail={detail}
              onOpenWorkerChat={onOpenWorkerChat}
              run={run}
            />
          </TabsContent>
          <TabsContent value="changes">
            <ChangesView detail={detail} run={run} />
          </TabsContent>
          <TabsContent value="evidence">
            <EvidenceView detail={detail} run={run} />
          </TabsContent>
          <TabsContent value="logs">
            <LogsView detail={detail} />
          </TabsContent>
        </div>
      </Tabs>
      <DetailStatusStrip
        detail={detail}
        detailError={detailError}
        detailLoading={detailLoading}
        detailStale={detailStale}
      />
    </div>
  );
}

/** Footer strip: only ever states what is true about the deep projection. */
function DetailStatusStrip({
  detail,
  detailError,
  detailLoading,
  detailStale,
}: {
  detail: SupervisorRunDetailClientView | null;
  detailError: string | null;
  detailLoading: boolean;
  detailStale: boolean;
}) {
  if (detailError) {
    return (
      <p className="shrink-0 border-t bg-destructive/5 px-4 py-1.5 text-destructive text-xs">
        Deep detail unavailable: {detailError}
      </p>
    );
  }
  if (detailLoading && !detail) {
    return (
      <p className="flex shrink-0 items-center gap-2 border-t px-4 py-1.5 text-muted-foreground text-xs">
        <Loader2 className="size-3 animate-spin" /> Loading deep evidence…
      </p>
    );
  }
  if (detailStale) {
    return (
      <p
        className="shrink-0 border-t px-4 py-1.5 text-muted-foreground text-xs"
        data-testid="run-detail-stale"
      >
        Deep evidence is catching up to the live status — the compact status
        above stays authoritative.
      </p>
    );
  }
  return null;
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed px-3 py-4 text-center text-muted-foreground text-xs">
      {children}
    </p>
  );
}

function OverviewView({
  run,
  detail,
  attention,
  waiting,
  actions,
  onAttentionAction,
}: {
  run: SupervisorRunClientUpdate;
  detail: SupervisorRunDetailClientView | null;
  attention: RunAttentionItem[];
  waiting: ReturnType<typeof getRunWaitingRows>;
  actions: RunWorkspaceActions;
  onAttentionAction: (
    item: RunAttentionItem,
    action: RunAttentionAction,
    draft: string
  ) => void;
}) {
  const progress = getRunProgress(run);
  const activity = getRunCurrentActivity(run);
  const goal = getRunGoalStatement(run, detail);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-4">
        <section>
          <h2 className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Goal
          </h2>
          <p
            className="rounded-lg border bg-card px-3 py-2.5 text-sm leading-relaxed"
            data-testid="run-goal-statement"
          >
            {goal}
          </p>
        </section>
        {activity ? (
          <section>
            <h2 className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Right now
            </h2>
            <div className="rounded-lg border bg-card px-3 py-2.5">
              <p className="font-medium text-sm">{activity.headline}</p>
              {activity.detail ? (
                <p className="mt-0.5 text-muted-foreground text-xs">
                  {activity.detail}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}
        <section>
          <h2 className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Needs attention ({attention.length})
          </h2>
          <NeedsAttentionPanel
            actionsDisabled={actions.isPending}
            items={attention}
            onAction={(item, action, draft) => {
              onAttentionAction(item, action, draft);
            }}
          />
        </section>
        {waiting.length > 0 ? (
          <section>
            <h2 className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Waiting ({waiting.length})
            </h2>
            <div className="rounded-lg border bg-card px-2 py-1.5">
              <RunWaitingList rows={waiting} />
            </div>
          </section>
        ) : null}
      </div>
      <aside className="grid gap-3 self-start rounded-lg border bg-card px-3 py-3">
        <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Facts
        </h2>
        <DetailRow label="Progress">
          {progress.completed}/{progress.total} tasks
        </DetailRow>
        {detail ? (
          <>
            <DetailRow label="Phase">{detail.phase}</DetailRow>
            <DetailRow label="Desired state">{detail.desiredState}</DetailRow>
            {detail.outcome ? (
              <DetailRow label="Outcome">{detail.outcome}</DetailRow>
            ) : null}
            <DetailRow label="Replans">{detail.plannerReplanCount}</DetailRow>
          </>
        ) : null}
        <DetailRow label="Created">
          {new Date(run.createdAt).toLocaleString()}
        </DetailRow>
        <DetailRow label="Updated">
          {new Date(run.updatedAt).toLocaleString()}
        </DetailRow>
        <DetailRow label="Priority">
          <select
            aria-label="Run priority"
            className="h-7 w-full rounded-md border bg-background px-2 text-xs"
            disabled={actions.isPending}
            onChange={(event) =>
              actions
                .setPriority(
                  run.runId,
                  event.target.value as SupervisorRunClientUpdate["priority"],
                  run.revision
                )
                .catch(() => undefined)
            }
            value={run.priority}
          >
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </DetailRow>
      </aside>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: mirrors the workflow graph state machine across stations, tasks, and attempts.
function WorkflowView({
  run,
  detail,
  selectedStationId,
  onSelectStation,
  onOpenWorkerChat,
}: {
  run: SupervisorRunClientUpdate;
  detail: SupervisorRunDetailClientView | null;
  selectedStationId: string | null;
  onSelectStation: (stationId: string | null) => void;
  onOpenWorkerChat: (chatId: string) => void;
}) {
  const model = buildSupervisorRunTimeline(run);
  const selected =
    model.stations.find((station) => station.id === selectedStationId) ?? null;
  const selectedTask =
    selected?.taskId != null
      ? run.tasks.find((task) => task.taskId === selected.taskId)
      : undefined;
  const selectedTaskDetail =
    selectedTask != null
      ? detail?.tasks.find((task) => task.taskId === selectedTask.taskId)
      : undefined;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 rounded-lg border bg-card px-3 py-3">
        <SupervisorWorkflowTimeline
          model={model}
          onOpenChat={(chatId) => onOpenWorkerChat(chatId)}
          onSelectStation={(station) =>
            onSelectStation(
              station.id === selectedStationId ? null : station.id
            )
          }
          selectedStationId={selectedStationId}
        />
      </div>
      <aside
        className="grid gap-3 self-start rounded-lg border bg-card px-3 py-3"
        data-testid="run-workflow-inspector"
      >
        <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Lifecycle spine
        </h2>
        <LifecycleSpine
          model={model}
          onOpenChat={(chatId) => onOpenWorkerChat(chatId)}
          onSelectStation={(station) =>
            onSelectStation(
              station.id === selectedStationId ? null : station.id
            )
          }
          selectedStationId={selectedStationId}
        />
        {selected ? (
          <div
            className="mt-2 border-t pt-2"
            data-testid="run-station-inspector"
          >
            <h3 className="font-medium text-xs">{selected.label}</h3>
            <StatusBadge className="mt-1" presentation={selected.status} />
            {selectedTask ? (
              <div className="mt-2 grid gap-1.5 text-xs">
                {selectedTaskDetail?.prompt ? (
                  <DetailRow label="Prompt">
                    <span className="line-clamp-4 whitespace-pre-wrap">
                      {selectedTaskDetail.prompt}
                    </span>
                  </DetailRow>
                ) : null}
                {selectedTask.dependencies.length > 0 ? (
                  <DetailRow label="Depends on">
                    {selectedTask.dependencies.join(", ")}
                  </DetailRow>
                ) : null}
                {(selectedTask.criterionIds ?? []).length > 0 ? (
                  <DetailRow label="Criteria">
                    {(selectedTask.criterionIds ?? []).join(", ")}
                  </DetailRow>
                ) : null}
                {selectedTaskDetail &&
                selectedTaskDetail.filesAllowed.total > 0 ? (
                  <DetailRow label="Allowed files">
                    {selectedTaskDetail.filesAllowed.total} path
                    {selectedTaskDetail.filesAllowed.total === 1 ? "" : "s"}
                  </DetailRow>
                ) : null}
              </div>
            ) : null}
            {selected.pills.length > 0 ? (
              <div className="mt-2 grid gap-1">
                {selected.pills.map((pill) => (
                  <AgentPill
                    chatId={pill.chatId}
                    identitySeed={pill.identitySeed}
                    key={pill.key}
                    label={pill.label}
                    onOpen={
                      pill.chatId
                        ? (chatId) => onOpenWorkerChat(chatId)
                        : undefined
                    }
                    status={pill.status}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="border-t pt-2 text-muted-foreground text-xs">
            Select a station to inspect its task, attempts, and transcripts.
          </p>
        )}
      </aside>
    </div>
  );
}

function TasksView({
  run,
  detail,
  actions,
  onOpenWorkerChat,
}: {
  run: SupervisorRunClientUpdate;
  detail: SupervisorRunDetailClientView | null;
  actions: RunWorkspaceActions;
  onOpenWorkerChat: (chatId: string) => void;
}) {
  if (run.tasks.length === 0) {
    return <EmptyNote>No tasks have been planned yet.</EmptyNote>;
  }
  return (
    <div className="grid gap-3">
      {run.tasks.map((task) => (
        <TaskCard
          actions={actions}
          detailTask={detail?.tasks.find(
            (candidate) => candidate.taskId === task.taskId
          )}
          key={task.taskId}
          onOpenWorkerChat={onOpenWorkerChat}
          run={run}
          task={task}
        />
      ))}
    </div>
  );
}

function TaskCard({
  task,
  detailTask,
  run,
  actions,
  onOpenWorkerChat,
}: {
  task: SupervisorRunClientUpdate["tasks"][number];
  detailTask?: SupervisorRunDetailClientView["tasks"][number];
  run: SupervisorRunClientUpdate;
  actions: RunWorkspaceActions;
  onOpenWorkerChat: (chatId: string) => void;
}) {
  const status = getTaskStatusPresentation(task);
  const retryable =
    (task.status === "failed" || task.status === "needs_user") &&
    (!run.limits || task.attempts.length < run.limits.maxAttemptsPerTask);
  return (
    <section
      className="rounded-lg border bg-card px-3 py-3"
      data-task-id={task.taskId}
      data-testid="workspace-task"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium text-sm">
          {task.title}
        </h3>
        <StatusBadge presentation={status} />
        <Badge variant="outline">{task.executionMode.replace("_", "-")}</Badge>
        {retryable ? (
          <Button
            className="h-7 gap-1 px-2 text-xs"
            disabled={actions.isPending}
            onClick={() =>
              actions.retryTask(run.runId, task.taskId).catch(() => undefined)
            }
            size="sm"
            type="button"
            variant="outline"
          >
            Retry
          </Button>
        ) : null}
      </div>
      {detailTask?.prompt ? (
        <p
          className="mt-1.5 line-clamp-2 text-muted-foreground text-xs"
          title={detailTask.prompt}
        >
          {detailTask.prompt}
        </p>
      ) : null}
      <div className="mt-2 grid gap-1">
        {task.dependencies.length > 0 ? (
          <DetailRow label="Depends on">
            {task.dependencies.join(", ")}
          </DetailRow>
        ) : null}
        {(task.criterionIds ?? []).length > 0 ? (
          <DetailRow label="Criteria">
            {(task.criterionIds ?? []).join(", ")}
          </DetailRow>
        ) : null}
        {detailTask && detailTask.verificationCommands.length > 0 ? (
          <DetailRow label="Verification">
            <ul className="space-y-0.5">
              {detailTask.verificationCommands.map((command) => (
                <li className="font-mono text-[11px]" key={command}>
                  {command}
                </li>
              ))}
            </ul>
          </DetailRow>
        ) : null}
        {detailTask && detailTask.filesAllowed.total > 0 ? (
          <DetailRow label="Allowed files">
            {detailTask.filesAllowed.total} path
            {detailTask.filesAllowed.total === 1 ? "" : "s"}
            {detailTask.filesAllowed.paths.length > 0 ? (
              <span className="block truncate font-mono text-[11px] text-muted-foreground">
                {detailTask.filesAllowed.paths.slice(0, 4).join(", ")}
                {detailTask.filesAllowed.paths.length > 4 ? ", …" : ""}
              </span>
            ) : null}
          </DetailRow>
        ) : null}
      </div>
      <div className="mt-2">
        <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Attempts ({task.attempts.length})
        </h4>
        {task.attempts.length === 0 ? (
          <p
            className="mt-1 rounded-sm bg-muted/40 px-2 py-1.5 text-muted-foreground text-xs"
            data-testid="attempt-not-started"
          >
            Not started — no worker has been dispatched for this task yet.
          </p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {task.attempts.map((attempt, index) => (
              <AttemptRow
                attemptIndex={index}
                chatId={attempt.chatId}
                detailAttempt={detailTask?.attempts.find(
                  (candidate) => candidate.attemptId === attempt.attemptId
                )}
                hasLaterAttempt={
                  index < task.attempts.length - 1 &&
                  task.status === "completed"
                }
                key={attempt.attemptId}
                label={`Attempt ${index + 1}`}
                onOpenWorkerChat={onOpenWorkerChat}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ChangesView({
  run,
  detail,
}: {
  run: SupervisorRunClientUpdate;
  detail: SupervisorRunDetailClientView | null;
}) {
  const sections = run.tasks.flatMap((task) => {
    const taskDetail = detail?.tasks.find(
      (candidate) => candidate.taskId === task.taskId
    );
    return task.attempts.map((attempt, index) => {
      const detailAttempt = taskDetail?.attempts.find(
        (candidate) => candidate.attemptId === attempt.attemptId
      );
      return { attempt, detailAttempt, index, task };
    });
  });
  if (sections.length === 0) {
    return (
      <EmptyNote>No worker has run yet, so no file changes exist.</EmptyNote>
    );
  }
  const anyFiles = sections.some(
    (section) =>
      section.detailAttempt && section.detailAttempt.files.touched.total > 0
  );
  return (
    <div className="grid gap-3">
      {anyFiles ? null : (
        <p
          className="rounded-md border border-dashed px-3 py-3 text-center text-muted-foreground text-xs"
          data-testid="changes-none"
        >
          No file changes recorded yet — read-only work produces no patch.
        </p>
      )}
      {sections.map(({ task, attempt, detailAttempt, index }) => (
        <section
          className="rounded-lg border bg-card px-3 py-3"
          data-testid="workspace-changes"
          key={attempt.attemptId}
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate font-medium text-xs">
              {task.title} — Attempt {index + 1}
            </h3>
            {detailAttempt?.checkpoint ? (
              <span
                className="font-mono text-[11px] text-muted-foreground"
                title={`Checkpoint sha256 ${detailAttempt.checkpoint.sha256}`}
              >
                checkpoint {detailAttempt.checkpoint.sha256.slice(0, 12)}
              </span>
            ) : null}
          </div>
          <AttemptChangesBody detailAttempt={detailAttempt} />
        </section>
      ))}
    </div>
  );
}

function AttemptChangesBody({
  detailAttempt,
}: {
  detailAttempt?: SupervisorRunDetailClientView["tasks"][number]["attempts"][number];
}) {
  if (!detailAttempt) {
    return (
      <p className="mt-1.5 text-muted-foreground text-xs">
        Deep evidence has not loaded for this attempt yet.
      </p>
    );
  }
  if (detailAttempt.files.touched.total === 0) {
    return (
      <p className="mt-1.5 text-muted-foreground text-xs">No files touched.</p>
    );
  }
  return (
    <div className="mt-2 grid gap-1.5">
      <FileList
        label={`Touched (${detailAttempt.files.touched.total})`}
        paths={detailAttempt.files.touched.paths}
      />
      {detailAttempt.files.created.total > 0 ? (
        <FileList
          label={`Created (${detailAttempt.files.created.total})`}
          paths={detailAttempt.files.created.paths}
          tone="success"
        />
      ) : null}
      {detailAttempt.files.deleted.total > 0 ? (
        <FileList
          label={`Deleted (${detailAttempt.files.deleted.total})`}
          paths={detailAttempt.files.deleted.paths}
          tone="failed"
        />
      ) : null}
      {detailAttempt.files.renamed.length > 0 ? (
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
            Renamed
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {detailAttempt.files.renamed.map((rename) => (
              <li
                className="truncate font-mono text-[11px]"
                key={`${rename.from}->${rename.to}`}
              >
                {rename.from} → {rename.to}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function FileList({
  label,
  paths,
  tone,
}: {
  label: string;
  paths: string[];
  tone?: "success" | "failed";
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <ul className="mt-0.5 space-y-0.5">
        {paths.map((path) => (
          <li
            className={cn(
              "truncate font-mono text-[11px]",
              tone === "success" && "text-status-success",
              tone === "failed" && "text-status-failed"
            )}
            key={path}
            title={path}
          >
            {path}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Honest empty states for aggregate verification: no fake success. */
function FinalVerificationEmpty({
  status,
}: {
  status: SupervisorRunClientUpdate["status"];
}) {
  if (status === "completed") {
    return (
      <p className="mt-1.5 text-muted-foreground text-xs">
        Completed on accepted task evidence; no aggregate commands were
        required.
      </p>
    );
  }
  return (
    <p className="mt-1.5 text-muted-foreground text-xs">
      Not run yet — aggregate verification happens at integration.
    </p>
  );
}

function EvidenceView({
  run,
  detail,
}: {
  run: SupervisorRunClientUpdate;
  detail: SupervisorRunDetailClientView | null;
}) {
  return (
    <div className="grid gap-3">
      <section className="rounded-lg border bg-card px-3 py-3">
        <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Final verification
        </h3>
        {detail && detail.finalVerification.length > 0 ? (
          <ul className="mt-1.5 space-y-1">
            {detail.finalVerification.map((check) => (
              <li
                className="flex flex-wrap items-center gap-2 text-xs"
                key={check.command}
              >
                <span
                  className={`font-mono ${check.exitCode === 0 ? "text-status-success" : "text-status-failed"}`}
                >
                  exit {check.exitCode ?? "—"}
                </span>
                <span className="font-mono">{check.command}</span>
                {check.outputSummary ? (
                  <span
                    className="w-full truncate text-muted-foreground"
                    title={check.outputSummary}
                  >
                    {check.outputSummary}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <FinalVerificationEmpty status={run.status} />
        )}
      </section>
      {run.tasks.flatMap((task) =>
        task.attempts.length === 0 ? (
          <p
            className="rounded-md border border-dashed px-3 py-2.5 text-muted-foreground text-xs"
            data-testid="evidence-not-started"
            key={`${task.taskId}-no-attempts`}
          >
            “{task.title}”: not started — no attempt evidence exists yet.
          </p>
        ) : (
          task.attempts.map((attempt, index) => (
            <AttemptEvidence
              attempt={attempt}
              detailAttempt={detail?.tasks
                .find((candidate) => candidate.taskId === task.taskId)
                ?.attempts.find(
                  (candidate) => candidate.attemptId === attempt.attemptId
                )}
              index={index}
              key={attempt.attemptId}
              task={task}
            />
          ))
        )
      )}
    </div>
  );
}

function AttemptEvidence({
  task,
  attempt,
  detailAttempt,
  index,
}: {
  task: SupervisorRunClientUpdate["tasks"][number];
  attempt: SupervisorRunClientUpdate["tasks"][number]["attempts"][number];
  detailAttempt?: SupervisorRunDetailClientView["tasks"][number]["attempts"][number];
  index: number;
}) {
  return (
    <section
      className="rounded-lg border bg-card px-3 py-3"
      data-testid="workspace-evidence"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium text-xs">
          {task.title} — Attempt {index + 1}
        </h3>
        {detailAttempt?.status === "uncertain" ? (
          <Badge
            className="border-status-attention/40 bg-status-attention/10 text-status-attention"
            variant="outline"
          >
            Uncertain outcome — inspect before continuing
          </Badge>
        ) : null}
      </div>
      {detailAttempt?.outcomeSummary ? (
        <p className="mt-1.5 text-xs leading-relaxed">
          {detailAttempt.outcomeSummary}
        </p>
      ) : null}
      {detailAttempt?.reason ? (
        <p className="mt-1 text-status-attention text-xs">
          Reason: {detailAttempt.reason}
        </p>
      ) : null}
      {detailAttempt && detailAttempt.verification.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {detailAttempt.verification.map((check) => (
            <li
              className="flex flex-wrap items-center gap-2 text-xs"
              key={check.command}
            >
              <span className={`font-mono ${exitCodeClass(check.exitCode)}`}>
                exit {check.exitCode ?? "—"}
              </span>
              <span className="font-mono">{check.command}</span>
              {check.outputSummary ? (
                <span
                  className="w-full truncate text-muted-foreground"
                  title={check.outputSummary}
                >
                  {check.outputSummary}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted-foreground text-xs">
          No verification commands recorded.
        </p>
      )}
      {detailAttempt && detailAttempt.unresolvedPermissions.length > 0 ? (
        <p className="mt-2 rounded-sm border border-status-attention/30 bg-status-attention/5 px-2 py-1 text-status-attention text-xs">
          Unresolved permissions:{" "}
          {detailAttempt.unresolvedPermissions.join(", ")}
        </p>
      ) : null}
      {detailAttempt && detailAttempt.toolFailureSummary.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {detailAttempt.toolFailureSummary.map((failure) => (
            <li
              className="truncate text-[11px] text-status-failed"
              key={failure}
              title={failure}
            >
              {failure}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {detailAttempt?.checkpoint ? (
          <span className="font-mono">
            checkpoint {detailAttempt.checkpoint.sha256.slice(0, 12)}
          </span>
        ) : null}
        {detailAttempt?.workspace ? (
          <span>workspace {detailAttempt.workspace.kind}</span>
        ) : null}
        {attempt.chatId ? (
          <span className="font-mono">transcript {attempt.chatId}</span>
        ) : (
          <span>transcript unavailable</span>
        )}
      </div>
    </section>
  );
}

function LogsView({
  detail,
}: {
  detail: SupervisorRunDetailClientView | null;
}) {
  if (!detail) {
    return <EmptyNote>Run audit loads with the deep detail view.</EmptyNote>;
  }
  if (detail.audit.entries.length === 0) {
    return <EmptyNote>No audit entries recorded yet.</EmptyNote>;
  }
  const entries = [...detail.audit.entries].reverse();
  return (
    <div className="grid gap-1.5" data-testid="run-logs">
      {detail.audit.truncated ? (
        <p
          className="text-[11px] text-muted-foreground"
          data-testid="run-logs-truncated"
        >
          Showing the latest {entries.length} of {detail.audit.total} audit
          entries.
        </p>
      ) : null}
      <ul className="space-y-1">
        {entries.map((entry) => (
          <li
            className="flex flex-wrap items-baseline gap-2 rounded-sm bg-muted/40 px-2 py-1.5 text-xs"
            key={entry.auditId}
          >
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {new Date(entry.createdAt).toLocaleTimeString()}
            </span>
            <span className="shrink-0 rounded-sm border bg-background px-1 text-[10px] text-muted-foreground">
              {entry.actor}
            </span>
            <span className="min-w-0 flex-1">{entry.summary}</span>
            {entry.taskId ? (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {entry.taskId}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

const SEMANTIC_STATUS_LABEL: Record<
  NonNullable<
    SupervisorRunDetailClientView["tasks"][number]["attempts"][number]["semanticStatus"]
  >,
  { label: string; className: string }
> = {
  succeeded: { label: "succeeded", className: "text-status-success text-xs" },
  failed: { label: "failed", className: "text-status-failed text-xs" },
  needs_user: {
    label: "needs user",
    className: "text-status-attention text-xs",
  },
  cancelled: { label: "cancelled", className: "text-muted-foreground text-xs" },
};

function AttemptStatusLabel({
  detailStatus,
  semanticStatus,
}: {
  detailStatus?:
    | "starting"
    | "running"
    | "waiting_capacity"
    | "uncertain"
    | "terminal"
    | "interrupted";
  semanticStatus?: "succeeded" | "needs_user" | "failed" | "cancelled";
}) {
  const semantic = semanticStatus
    ? SEMANTIC_STATUS_LABEL[semanticStatus]
    : undefined;
  if (semantic) {
    return <span className={semantic.className}>{semantic.label}</span>;
  }
  if (detailStatus === "running" || detailStatus === "starting") {
    return <span className="text-status-running text-xs">running</span>;
  }
  return null;
}

function exitCodeClass(exitCode: number | null | undefined): string {
  if (exitCode === 0) {
    return "text-status-success";
  }
  if (exitCode == null) {
    return "text-muted-foreground";
  }
  return "text-status-failed";
}

function AttemptRow({
  attemptIndex,
  chatId,
  detailAttempt,
  hasLaterAttempt,
  label,
  onOpenWorkerChat,
}: {
  attemptIndex: number;
  chatId?: string;
  detailAttempt?: SupervisorRunDetailClientView["tasks"][number]["attempts"][number];
  hasLaterAttempt: boolean;
  label: string;
  onOpenWorkerChat: (chatId: string) => void;
}) {
  const statusTone = detailAttempt?.semanticStatus;
  const uncertain = detailAttempt?.status === "uncertain";
  return (
    <li
      className="flex flex-wrap items-center gap-2 rounded-sm bg-muted/40 px-2 py-1.5"
      data-testid="workspace-attempt"
    >
      <span className="font-medium text-xs">{label}</span>
      {detailAttempt?.agentId ? (
        <span className="text-muted-foreground text-xs">
          {detailAttempt.agentId}
        </span>
      ) : null}
      {uncertain ? (
        <Badge
          className="border-status-attention/40 bg-status-attention/10 text-status-attention"
          variant="outline"
        >
          uncertain
        </Badge>
      ) : (
        <AttemptStatusLabel
          detailStatus={detailAttempt?.status}
          semanticStatus={statusTone}
        />
      )}
      {hasLaterAttempt && (
        <span className="text-[11px] text-muted-foreground italic">
          superseded
        </span>
      )}
      {chatId ? (
        <Button
          aria-label={`Open worker chat for attempt ${attemptIndex + 1}`}
          className="ml-auto h-6 gap-1 px-1.5 text-xs"
          onClick={() => onOpenWorkerChat(chatId)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ExternalLink className="size-3 text-muted-foreground" /> Transcript
        </Button>
      ) : (
        <span className="ml-auto text-[11px] text-muted-foreground italic">
          no transcript recorded
        </span>
      )}
    </li>
  );
}
