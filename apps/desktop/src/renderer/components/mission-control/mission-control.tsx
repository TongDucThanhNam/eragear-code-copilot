import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CirclePause,
  CirclePlay,
  Clock3,
  ExternalLink,
  GitCommit,
  History,
  Network,
  Plus,
  RotateCcw,
  Settings2,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { upsertSupervisorRun } from "@/hooks/use-supervisor-runs";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/store/project-store";
import {
  countActionableSupervisorDecisions,
  getDirectRepositoryBlocker,
  getSupervisorRunTitle,
  isTerminalSupervisorRun,
  type MissionControlRunView,
  selectMissionControlRuns,
} from "./mission-control-utils";

const RUN_LIST_INPUT = { includeTerminal: true } as const;

export function MissionControl() {
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject = projects.find((item) => item.id === activeProjectId);
  const runsQuery = trpc.supervisorRuns.list.useQuery(RUN_LIST_INPUT, {
    refetchOnWindowFocus: false,
  });
  const profilesQuery = trpc.supervisorRuns.profiles.list.useQuery(
    activeProjectId ? { projectId: activeProjectId } : undefined
  );
  const telegramStatus = trpc.supervisorRuns.telegram.status.useQuery();
  const syncRun = useCallback(
    (update: SupervisorRunClientUpdate) => {
      utils.supervisorRuns.list.setData(RUN_LIST_INPUT, (current) =>
        upsertSupervisorRun(current, update)
      );
    },
    [utils]
  );
  trpc.supervisorRuns.updates.useSubscription(undefined, {
    onData: syncRun,
  });
  const onActionError = useCallback(
    (error: { message?: string }) =>
      toast.error(error.message || "Supervisor action failed"),
    []
  );
  const [goalComposerOpen, setGoalComposerOpen] = useState(false);
  const createDraft = trpc.supervisorRuns.createDraft.useMutation({
    onSuccess(update) {
      syncRun(update);
      setNewGoal("");
      setGoalComposerOpen(false);
      toast.success("Manager started planning the new goal");
    },
    onError: onActionError,
  });
  const approve = trpc.supervisorRuns.approvePlan.useMutation({
    onSuccess(update) {
      syncRun(update);
      toast.success("Supervisor plan approved");
    },
    onError: onActionError,
  });
  const requestChanges = trpc.supervisorRuns.requestPlanChanges.useMutation({
    onSuccess(update) {
      syncRun(update);
      toast.success("Plan changes sent to the manager");
    },
    onError: onActionError,
  });
  const answerDecision = trpc.supervisorRuns.answerDecision.useMutation({
    onSuccess(update) {
      syncRun(update);
      toast.success("Decision answered");
    },
    onError: onActionError,
  });
  const setPriority = trpc.supervisorRuns.setPriority.useMutation({
    onSuccess: syncRun,
    onError: onActionError,
  });
  const pause = trpc.supervisorRuns.pause.useMutation({
    onSuccess(update) {
      syncRun(update);
      toast.success("Supervisor run paused");
    },
    onError: onActionError,
  });
  const resume = trpc.supervisorRuns.resume.useMutation({
    onSuccess(update) {
      syncRun(update);
      toast.success("Supervisor run resumed");
    },
    onError: onActionError,
  });
  const cancel = trpc.supervisorRuns.cancel.useMutation({
    onSuccess(update) {
      syncRun(update);
      toast.success("Supervisor run cancelled");
    },
    onError: onActionError,
  });
  const replan = trpc.supervisorRuns.replan.useMutation({
    onSuccess(update) {
      syncRun(update);
      toast.success("Manager replan started");
    },
    onError: onActionError,
  });
  const retryTask = trpc.supervisorRuns.retryTask.useMutation({
    onSuccess(update) {
      syncRun(update);
      toast.success(
        update.status === "queued" ? "Task queued for retry" : "Task retried"
      );
    },
    onError: onActionError,
  });
  const testResume = trpc.supervisorRuns.profiles.testResume.useMutation({
    onSuccess: () => utils.supervisorRuns.profiles.list.invalidate(),
  });
  const configureTelegram = trpc.supervisorRuns.telegram.configure.useMutation({
    onSuccess: () => utils.supervisorRuns.telegram.status.invalidate(),
  });
  const beginTelegramPairing =
    trpc.supervisorRuns.telegram.beginPairing.useMutation();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramTimezone, setTelegramTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );
  const [newGoal, setNewGoal] = useState("");
  const [runView, setRunView] = useState<MissionControlRunView>("active");
  const runs = runsQuery.data ?? [];
  const activeRuns = useMemo(
    () => selectMissionControlRuns(runs, "active"),
    [runs]
  );
  const historicalRuns = useMemo(
    () => selectMissionControlRuns(runs, "history"),
    [runs]
  );
  const visibleRuns = runView === "active" ? activeRuns : historicalRuns;
  const stats = useMemo(
    () => ({
      approvals: runs.filter((run) => run.status === "awaiting_approval")
        .length,
      capacity: runs.filter((run) => run.status === "waiting_capacity").length,
      decisions: countActionableSupervisorDecisions(runs),
      active: runs.filter((run) =>
        ["planning", "queued", "running", "completing"].includes(run.status)
      ).length,
    }),
    [runs]
  );

  const pending =
    createDraft.isPending ||
    approve.isPending ||
    requestChanges.isPending ||
    answerDecision.isPending ||
    setPriority.isPending ||
    pause.isPending ||
    resume.isPending ||
    cancel.isPending ||
    replan.isPending ||
    retryTask.isPending;
  let telegramStatusLabel = "not configured";
  if (telegramStatus.data?.configured) {
    telegramStatusLabel = "configured";
  }
  if (telegramStatus.data?.paired) {
    telegramStatusLabel = "paired";
  }

  const approveRunPlan = (run: SupervisorRunClientUpdate) => {
    if (!run.plan) {
      return;
    }
    approve.mutate({
      runId: run.runId,
      planVersion: run.plan.version,
      planHash: run.plan.hash,
      expectedRevision: run.revision,
    });
  };

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-background p-4 md:p-6">
      <div className="mx-auto grid max-w-7xl gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Network className="size-5" />
              <h1 className="font-semibold text-xl">Mission Control</h1>
            </div>
            <p className="mt-1 text-muted-foreground text-sm">
              Run goals, clear exceptions, and inspect worker evidence.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              className="gap-1.5"
              disabled={!activeProject}
              onClick={() => setGoalComposerOpen(true)}
              size="sm"
              type="button"
            >
              <Plus className="size-3.5" /> New goal
            </Button>
            <Button
              className="gap-1.5"
              disabled={
                runsQuery.isFetching ||
                profilesQuery.isFetching ||
                telegramStatus.isFetching
              }
              onClick={() => {
                runsQuery.refetch();
                profilesQuery.refetch();
                telegramStatus.refetch();
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <RotateCcw className="size-3.5" /> Refresh
            </Button>
          </div>
        </header>

        <Dialog onOpenChange={setGoalComposerOpen} open={goalComposerOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Start a managed goal</DialogTitle>
              <DialogDescription>
                The Manager plans for{" "}
                {activeProject?.name ?? "the active project"}. You approve the
                exact task graph before workers start.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              aria-label="New Supervisor goal"
              className="min-h-36 resize-y bg-background"
              disabled={!activeProject || createDraft.isPending}
              onChange={(event) => setNewGoal(event.target.value)}
              placeholder={
                activeProject
                  ? `Describe the outcome for ${activeProject.name}`
                  : "Select a project first"
              }
              value={newGoal}
            />
            <DialogFooter showCloseButton>
              <Button
                disabled={
                  !activeProject || createDraft.isPending || !newGoal.trim()
                }
                onClick={() => {
                  if (!activeProject) {
                    return;
                  }
                  createDraft.mutate({
                    projectId: activeProject.id,
                    intent: newGoal.trim(),
                    constraints: [],
                    priority: "normal",
                  });
                }}
                type="button"
              >
                {createDraft.isPending ? "Starting Manager…" : "Plan goal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <section className="flex flex-wrap gap-2">
          <Stat label="Awaiting approval" value={stats.approvals} />
          <Stat label="Waiting capacity" value={stats.capacity} />
          <Stat label="Open decisions" value={stats.decisions} />
          <Stat label="Active goals" value={stats.active} />
        </section>

        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">Goals</h2>
              <p className="text-muted-foreground text-xs">
                Live work and decisions stay separate from completed history.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
              <Button
                aria-pressed={runView === "active"}
                onClick={() => setRunView("active")}
                size="sm"
                type="button"
                variant={runView === "active" ? "secondary" : "ghost"}
              >
                Active & attention · {activeRuns.length}
              </Button>
              <Button
                aria-pressed={runView === "history"}
                className="gap-1.5"
                onClick={() => setRunView("history")}
                size="sm"
                type="button"
                variant={runView === "history" ? "secondary" : "ghost"}
              >
                <History className="size-3.5" /> History ·{" "}
                {historicalRuns.length}
              </Button>
            </div>
          </div>
          {visibleRuns.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card/50 p-8 text-center">
              <CheckCircle2 className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-2 font-medium text-sm">
                {runView === "active"
                  ? "No active or attention-required goals"
                  : "No historical goals"}
              </p>
            </div>
          ) : null}
          {visibleRuns.map(
            // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the run card mirrors explicit Supervisor state-machine actions.
            (run) => {
              const directBlocker = getDirectRepositoryBlocker(run, runs);
              return (
                <article
                  className="rounded-xl border bg-card p-4"
                  key={run.runId}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-medium text-sm">
                        {getSupervisorRunTitle(run)}
                      </h3>
                      <div
                        className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                        title={run.runId}
                      >
                        {run.runId}
                      </div>
                      <div className="mt-1 text-muted-foreground text-xs">
                        {run.tasks.length} tasks · plan v
                        {run.plan?.version ?? "—"} · revision {run.revision}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <select
                        aria-label={`Priority for ${run.runId}`}
                        className="h-7 rounded-md border bg-background px-2 text-xs"
                        disabled={pending}
                        onChange={(event) =>
                          setPriority.mutate({
                            runId: run.runId,
                            priority: event.target
                              .value as SupervisorRunClientUpdate["priority"],
                            expectedRevision: run.revision,
                          })
                        }
                        value={run.priority}
                      >
                        <option value="urgent">Urgent</option>
                        <option value="high">High</option>
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                      </select>
                      <Badge
                        variant={
                          run.status === "needs_user"
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {run.status.replaceAll("_", " ")}
                      </Badge>
                      {run.status === "queued" || run.status === "running" ? (
                        <Button
                          aria-label={`Pause ${getSupervisorRunTitle(run)}`}
                          className="gap-1.5"
                          disabled={pending}
                          onClick={() => pause.mutate({ runId: run.runId })}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <CirclePause className="size-3.5" /> Pause
                        </Button>
                      ) : null}
                      {run.status === "paused" ? (
                        <Button
                          aria-label={`Resume ${getSupervisorRunTitle(run)}`}
                          className="gap-1.5"
                          disabled={pending}
                          onClick={() => resume.mutate({ runId: run.runId })}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <CirclePlay className="size-3.5" /> Resume
                        </Button>
                      ) : null}
                      {run.status === "needs_user" ? (
                        <Button
                          aria-label={`Replan ${getSupervisorRunTitle(run)}`}
                          className="gap-1.5"
                          disabled={pending}
                          onClick={() => replan.mutate({ runId: run.runId })}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <RotateCcw className="size-3.5" /> Replan
                        </Button>
                      ) : null}
                      {isTerminalSupervisorRun(run) ? null : (
                        <Button
                          aria-label={`Cancel ${getSupervisorRunTitle(run)}`}
                          className="gap-1.5"
                          disabled={pending}
                          onClick={() => cancel.mutate({ runId: run.runId })}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <Square className="size-3.5" /> Cancel
                        </Button>
                      )}
                    </div>
                  </div>

                  {directBlocker ? (
                    <div className="mt-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
                      <Clock3 className="size-3.5 shrink-0 text-amber-500" />
                      <span>
                        Direct branch busy with{" "}
                        <strong>{getSupervisorRunTitle(directBlocker)}</strong>.
                        This run starts after that worker releases the
                        repository.
                      </span>
                    </div>
                  ) : null}

                  {run.plan ? (
                    <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div
                          className="min-w-0 flex-1 text-muted-foreground"
                          title={run.plan.summary}
                        >
                          {run.plan.summary}
                        </div>
                        <div className="shrink-0 text-muted-foreground">
                          {run.plan.envelope.fileScopes.length} scopes ·{" "}
                          {run.plan.envelope.verificationCommands.length} checks
                          · {run.plan.hash.slice(0, 8)}
                        </div>
                      </div>
                      {run.status === "awaiting_approval" ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr_auto]">
                          <Button
                            disabled={pending}
                            onClick={() => approveRunPlan(run)}
                            size="sm"
                          >
                            Approve exact plan
                          </Button>
                          <Input
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [`plan:${run.runId}`]: event.target.value,
                              }))
                            }
                            placeholder="Request bounded plan changes"
                            value={drafts[`plan:${run.runId}`] ?? ""}
                          />
                          <Button
                            disabled={
                              pending ||
                              !(drafts[`plan:${run.runId}`] ?? "").trim()
                            }
                            onClick={() =>
                              requestChanges.mutate({
                                runId: run.runId,
                                requestedChanges: (
                                  drafts[`plan:${run.runId}`] ?? ""
                                ).trim(),
                                expectedRevision: run.revision,
                              })
                            }
                            size="sm"
                            variant="outline"
                          >
                            Request changes
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {run.capacityWaits.length > 0 ? (
                    <div className="mt-3 grid gap-1 text-xs">
                      {run.capacityWaits.map((wait) => (
                        <div
                          className="flex items-center gap-2"
                          key={wait.waitId}
                        >
                          <Clock3 className="size-3.5" />
                          {wait.agentId} · {wait.kind} · retry{" "}
                          {new Date(wait.retryAt).toLocaleString()}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {isTerminalSupervisorRun(run)
                    ? null
                    : run.decisions
                        .filter((decision) => decision.status === "open")
                        .map((decision) => (
                          <div
                            className="mt-3 rounded-lg border border-amber-500/30 p-3"
                            key={decision.decisionId}
                          >
                            <div className="flex items-center gap-2 text-xs">
                              <AlertTriangle className="size-3.5 text-amber-500" />
                              {decision.prompt}
                            </div>
                            <div className="mt-2 flex gap-2">
                              <Input
                                onChange={(event) =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [decision.decisionId]: event.target.value,
                                  }))
                                }
                                placeholder="Answer this exception"
                                value={drafts[decision.decisionId] ?? ""}
                              />
                              <Button
                                disabled={
                                  pending ||
                                  !(drafts[decision.decisionId] ?? "").trim()
                                }
                                onClick={() =>
                                  answerDecision.mutate({
                                    runId: run.runId,
                                    decisionId: decision.decisionId,
                                    answer: (
                                      drafts[decision.decisionId] ?? ""
                                    ).trim(),
                                    expectedRevision: run.revision,
                                  })
                                }
                                size="sm"
                              >
                                Answer
                              </Button>
                            </div>
                          </div>
                        ))}

                  <Collapsible className="mt-3">
                    <CollapsibleTrigger asChild>
                      <button
                        className="group flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs hover:bg-muted/40"
                        type="button"
                      >
                        <span>
                          Task graph · {run.tasks.length} task
                          {run.tasks.length === 1 ? "" : "s"} ·{" "}
                          {run.tasks.reduce(
                            (count, task) => count + task.attempts.length,
                            0
                          )}{" "}
                          attempts
                        </span>
                        <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {run.tasks.map((task) => (
                          <div
                            className="rounded-lg border p-3 text-xs"
                            key={task.taskId}
                          >
                            <div className="flex justify-between gap-2">
                              <span className="font-medium">{task.title}</span>
                              <span className="text-muted-foreground">
                                {task.status}
                              </span>
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              {task.role} · {task.dependencies.length}{" "}
                              dependencies · {task.attempts.length} attempts
                              {task.preferredModelId
                                ? ` · ${task.preferredModelId}`
                                : ""}
                            </div>
                            {task.attempts.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {task.attempts.map((attempt, index) => (
                                  <Button
                                    className="h-7 gap-1.5 px-2 text-xs"
                                    key={attempt.attemptId}
                                    onClick={() =>
                                      navigate({
                                        to: "/",
                                        search: { chatId: attempt.chatId },
                                      })
                                    }
                                    size="sm"
                                    type="button"
                                    variant="ghost"
                                  >
                                    <ExternalLink className="size-3" /> Worker{" "}
                                    {index + 1}
                                  </Button>
                                ))}
                              </div>
                            ) : null}
                            {(task.status === "failed" ||
                              task.status === "needs_user") &&
                            (!run.limits ||
                              task.attempts.length <
                                run.limits.maxAttemptsPerTask) ? (
                              <Button
                                className="mt-2 h-7 gap-1.5 px-2 text-xs"
                                disabled={pending}
                                onClick={() =>
                                  retryTask.mutate({
                                    runId: run.runId,
                                    taskId: task.taskId,
                                  })
                                }
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                <RotateCcw className="size-3" /> Retry task
                              </Button>
                            ) : null}
                            {(task.status === "failed" ||
                              task.status === "needs_user") &&
                            run.limits &&
                            task.attempts.length >=
                              run.limits.maxAttemptsPerTask ? (
                              <p className="mt-2 text-muted-foreground">
                                Attempt budget exhausted · use Replan
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {run.finalCommitSha ? (
                    <div className="mt-3 flex items-center gap-2 text-xs">
                      <GitCommit className="size-3.5" /> Final commit{" "}
                      {run.finalCommitSha}
                    </div>
                  ) : null}
                  {!run.finalCommitSha && run.status === "completed" ? (
                    <div className="mt-3 flex items-center gap-2 text-xs">
                      <CheckCircle2 className="size-3.5" /> Deterministic
                      verification complete
                    </div>
                  ) : null}
                </article>
              );
            }
          )}
        </section>

        <section>
          <Collapsible className="rounded-xl border bg-card">
            <CollapsibleTrigger asChild>
              <button
                className="group flex w-full items-center justify-between gap-4 p-4 text-left"
                type="button"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="rounded-lg bg-muted p-2">
                    <Settings2 className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-sm">
                      Automation & connections
                    </span>
                    <span className="block truncate text-muted-foreground text-xs">
                      Telegram {telegramStatusLabel} · runtime daemon · agent
                      readiness
                    </span>
                  </span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid gap-5 border-t p-4">
                <RuntimeDaemonControl />

                <section className="grid gap-3">
                  <div>
                    <h2 className="font-medium text-sm">Telegram control</h2>
                    <p className="text-muted-foreground text-xs">
                      The runtime encrypts bot tokens and never returns them to
                      the renderer.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto]">
                    <Input
                      autoComplete="off"
                      onChange={(event) => setTelegramToken(event.target.value)}
                      placeholder="Telegram bot token"
                      type="password"
                      value={telegramToken}
                    />
                    <Input
                      onChange={(event) =>
                        setTelegramTimezone(event.target.value)
                      }
                      placeholder="Timezone"
                      value={telegramTimezone}
                    />
                    <Button
                      disabled={
                        configureTelegram.isPending ||
                        telegramToken.trim().length < 20
                      }
                      onClick={() =>
                        configureTelegram.mutate({
                          botToken: telegramToken.trim(),
                          timezone: telegramTimezone.trim(),
                        })
                      }
                      size="sm"
                    >
                      Save encrypted
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <Badge
                      variant={
                        telegramStatus.data?.paired ? "secondary" : "outline"
                      }
                    >
                      {telegramStatusLabel}
                    </Badge>
                    <Button
                      disabled={
                        !telegramStatus.data?.configured ||
                        beginTelegramPairing.isPending
                      }
                      onClick={() => beginTelegramPairing.mutate()}
                      size="sm"
                      variant="outline"
                    >
                      Create one-time code
                    </Button>
                    {beginTelegramPairing.data ? (
                      <span className="font-mono">
                        {beginTelegramPairing.data.code} · expires{" "}
                        {new Date(
                          beginTelegramPairing.data.expiresAt
                        ).toLocaleTimeString()}
                      </span>
                    ) : null}
                  </div>
                </section>

                <section className="grid gap-3">
                  <h2 className="font-medium text-sm">
                    Agent capacity & readiness
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    {(profilesQuery.data ?? []).map((profile) => (
                      <article
                        className="rounded-lg border bg-background p-3"
                        key={profile.agentId}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm">
                            {profile.agentId}
                          </span>
                          <Badge
                            variant={profile.enabled ? "secondary" : "outline"}
                          >
                            {profile.enabled ? "enabled" : "disabled"}
                          </Badge>
                        </div>
                        <div className="mt-2 text-muted-foreground text-xs">
                          {profile.roles.join(", ")} · max{" "}
                          {profile.maxConcurrentSessions}
                        </div>
                        <div className="mt-1 text-xs">
                          Handshake {profile.readiness.handshake} · exact resume{" "}
                          {profile.readiness.exactResume}
                        </div>
                        <Button
                          className="mt-3"
                          disabled={!activeProject || testResume.isPending}
                          onClick={() =>
                            activeProject &&
                            testResume.mutate({
                              agentId: profile.agentId,
                              projectId: activeProject.id,
                            })
                          }
                          size="sm"
                          variant="outline"
                        >
                          Test exact resume
                        </Button>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5">
      <div className="font-semibold text-sm tabular-nums">{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}

interface RuntimeDaemonStatus {
  supported: boolean;
  installed: boolean;
  running: boolean;
  endpoint?: string;
  message: string;
}

function RuntimeDaemonControl() {
  const [status, setStatus] = useState<RuntimeDaemonStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const bridge = window.eragearDesktop?.runtimeDaemon;
    if (!bridge) {
      return;
    }
    setStatus(toRuntimeDaemonStatus(await bridge.status()));
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const invoke = async (action: "install" | "start" | "stop") => {
    const bridge = window.eragearDesktop?.runtimeDaemon;
    if (!bridge) {
      return;
    }
    setBusy(true);
    try {
      setStatus(toRuntimeDaemonStatus(await bridge[action]()));
    } finally {
      setBusy(false);
    }
  };

  if (!window.eragearDesktop?.runtimeDaemon) {
    return null;
  }
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
      <div>
        <h2 className="font-medium text-sm">User runtime daemon</h2>
        <p className="text-muted-foreground text-xs">
          {status?.message ?? "Checking daemon status…"}
          {status?.endpoint ? ` ${status.endpoint}` : ""}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={busy || !status?.supported || status.installed}
          onClick={() => invoke("install")}
          size="sm"
          variant="outline"
        >
          Install
        </Button>
        <Button
          disabled={busy || !status?.supported || status.running}
          onClick={() => invoke("start")}
          size="sm"
          variant="outline"
        >
          Start
        </Button>
        <Button
          disabled={busy || !status?.running}
          onClick={() => invoke("stop")}
          size="sm"
          variant="outline"
        >
          Stop
        </Button>
      </div>
    </section>
  );
}

function toRuntimeDaemonStatus(value: unknown): RuntimeDaemonStatus {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid runtime daemon status");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.supported !== "boolean" ||
    typeof candidate.installed !== "boolean" ||
    typeof candidate.running !== "boolean" ||
    typeof candidate.message !== "string"
  ) {
    throw new Error("Invalid runtime daemon status");
  }
  return {
    supported: candidate.supported,
    installed: candidate.installed,
    running: candidate.running,
    message: candidate.message,
    ...(typeof candidate.endpoint === "string"
      ? { endpoint: candidate.endpoint }
      : {}),
  };
}
