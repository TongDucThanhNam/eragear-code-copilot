import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import { useNavigate } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
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
import { Input } from "@/components/ui/input";
import { upsertSupervisorRun } from "@/hooks/use-supervisor-runs";
import { type AppRouter, trpc } from "@/lib/trpc";
import { useProjectStore } from "@/store/project-store";
import type { ManagedGoalDiscoveryProjectSnapshot } from "./managed-goal-discovery";
import {
  ManagedGoalDiscoveryDialog,
  type ManagedGoalDiscoverySubmitHandler,
} from "./managed-goal-discovery-dialog";
import {
  runGoalIntakeMutationWithRecovery,
  upsertGoalIntake,
} from "./managed-goal-intake";
import {
  type ManagedGoalIntakeActions,
  ManagedGoalIntakeCards,
} from "./managed-goal-intake-cards";
import {
  countActionableSupervisorDecisions,
  getDirectRepositoryBlocker,
  getGoalIntakeRefetchInterval,
  getSupervisorCancellationNotice,
  getSupervisorCancellationPresentation,
  getSupervisorRunTitle,
  isTerminalSupervisorRun,
  type MissionControlRunView,
  selectMissionControlProjectItems,
  selectMissionControlRuns,
} from "./mission-control-utils";

type SupervisorGoalProjection =
  inferRouterOutputs<AppRouter>["supervisorGoals"]["list"][number];

function valuesOrEmpty<T>(values: readonly T[] | undefined): readonly T[] {
  return values ?? [];
}

function requireScopedGoalIntake(
  intakes: readonly SupervisorGoalProjection[],
  intakeId: string,
  activeProjectId: string | null
): string {
  const intake = intakes.find((candidate) => candidate.intakeId === intakeId);
  if (!(activeProjectId && intake) || intake.projectId !== activeProjectId) {
    throw new Error(
      "This Goal does not belong to the active project. Switch back to its owning project before continuing."
    );
  }
  return activeProjectId;
}

export function MissionControl() {
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setActiveProjectId = useProjectStore(
    (state) => state.setActiveProjectId
  );
  const activeProject = projects.find((item) => item.id === activeProjectId);
  const runListInput = useMemo(
    () =>
      activeProjectId
        ? { includeTerminal: true as const, projectId: activeProjectId }
        : undefined,
    [activeProjectId]
  );
  const runsQuery = trpc.supervisorRuns.list.useQuery(runListInput, {
    enabled: Boolean(activeProjectId),
    refetchOnWindowFocus: false,
  });
  const profilesQuery = trpc.supervisorRuns.profiles.list.useQuery(
    activeProjectId ? { projectId: activeProjectId } : undefined,
    { enabled: Boolean(activeProjectId), refetchOnWindowFocus: false }
  );
  const goalIntakesQuery = trpc.supervisorGoals.list.useQuery(
    activeProjectId
      ? { projectId: activeProjectId, includeConverted: false }
      : undefined,
    {
      enabled: Boolean(activeProjectId),
      refetchInterval: (query) =>
        getGoalIntakeRefetchInterval(query.state.data),
      refetchOnWindowFocus: false,
    }
  );
  const telegramStatus = trpc.supervisorRuns.telegram.status.useQuery();
  const syncRun = useCallback(
    (update: SupervisorRunClientUpdate) => {
      if (!activeProjectId || update.projectId !== activeProjectId) {
        return;
      }
      utils.supervisorRuns.list.setData(runListInput, (current) =>
        upsertSupervisorRun(current, update)
      );
    },
    [activeProjectId, runListInput, utils]
  );
  trpc.supervisorRuns.updates.useSubscription(
    activeProjectId ? { projectId: activeProjectId } : undefined,
    {
      enabled: Boolean(activeProjectId),
      onData: syncRun,
    }
  );
  const syncGoalIntake = useCallback(
    (update: SupervisorGoalProjection) => {
      utils.supervisorGoals.list.setData(
        { projectId: update.projectId, includeConverted: false },
        (current) => upsertGoalIntake(current, update)
      );
    },
    [utils]
  );
  const executeGoalIntakeMutation = useCallback(
    <T,>(execute: () => Promise<T>, projectId: string) =>
      runGoalIntakeMutationWithRecovery(execute, () =>
        utils.supervisorGoals.list.invalidate({
          projectId,
          includeConverted: false,
        })
      ),
    [utils]
  );
  const onActionError = useCallback(
    (error: { message?: string }) =>
      toast.error(error.message || "Supervisor action failed"),
    []
  );
  const [goalComposerOpen, setGoalComposerOpen] = useState(false);
  const [goalComposerProject, setGoalComposerProject] =
    useState<ManagedGoalDiscoveryProjectSnapshot | null>(null);
  const createGoalIntake = trpc.supervisorGoals.create.useMutation();
  const answerGoalIntake = trpc.supervisorGoals.answer.useMutation();
  const resumeGoalIntake = trpc.supervisorGoals.resume.useMutation();
  const prepareGoalConsultation =
    trpc.supervisorGoals.prepareConsultation.useMutation();
  const importGoalConsultation =
    trpc.supervisorGoals.importConsultation.useMutation();
  const approveGoalIntake = trpc.supervisorGoals.approve.useMutation();
  const convertGoalIntake = trpc.supervisorGoals.convert.useMutation();
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
      const notice = getSupervisorCancellationNotice(update);
      toast[notice.kind](notice.message);
    },
    onError(error) {
      onActionError(error);
      runsQuery.refetch().catch(onActionError);
    },
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
  const [runView, setRunView] = useState<MissionControlRunView>("active");
  const runs = useMemo(
    () =>
      selectMissionControlProjectItems(runsQuery.data, activeProjectId ?? null),
    [activeProjectId, runsQuery.data]
  );
  const activeRuns = useMemo(
    () => selectMissionControlRuns(runs, "active"),
    [runs]
  );
  const historicalRuns = useMemo(
    () => selectMissionControlRuns(runs, "history"),
    [runs]
  );
  const visibleRuns = runView === "active" ? activeRuns : historicalRuns;
  const goalIntakes = useMemo(
    () =>
      selectMissionControlProjectItems(
        goalIntakesQuery.data,
        activeProjectId ?? null
      ),
    [activeProjectId, goalIntakesQuery.data]
  );
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
    approve.isPending ||
    requestChanges.isPending ||
    answerDecision.isPending ||
    setPriority.isPending ||
    pause.isPending ||
    resume.isPending ||
    cancel.isPending ||
    replan.isPending ||
    retryTask.isPending;

  const startGoalDiscovery: ManagedGoalDiscoverySubmitHandler = async (
    submission,
    project
  ) => {
    const intake = await executeGoalIntakeMutation(
      () =>
        createGoalIntake.mutateAsync({
          projectId: project.id,
          title: submission.title,
          roughOutcome: submission.seedIntent,
          depth: submission.depth,
          providers: submission.providers,
        }),
      project.id
    );
    syncGoalIntake(intake);
    toast.success("Goal discovery started");
  };

  const goalIntakeActions: ManagedGoalIntakeActions = {
    async answer(input) {
      const projectId = requireScopedGoalIntake(
        goalIntakes,
        input.intakeId,
        activeProjectId
      );
      const updated = await executeGoalIntakeMutation(
        () => answerGoalIntake.mutateAsync(input),
        projectId
      );
      syncGoalIntake(updated);
      return updated;
    },
    async resume(input) {
      const projectId = requireScopedGoalIntake(
        goalIntakes,
        input.intakeId,
        activeProjectId
      );
      const updated = await executeGoalIntakeMutation(
        () => resumeGoalIntake.mutateAsync(input),
        projectId
      );
      syncGoalIntake(updated);
      return updated;
    },
    async prepareConsultation(input) {
      const projectId = requireScopedGoalIntake(
        goalIntakes,
        input.intakeId,
        activeProjectId
      );
      const prepared = await executeGoalIntakeMutation(
        () => prepareGoalConsultation.mutateAsync(input),
        projectId
      );
      syncGoalIntake(prepared.intake);
      return prepared;
    },
    exportConsultation(input) {
      requireScopedGoalIntake(goalIntakes, input.intakeId, activeProjectId);
      return utils.supervisorGoals.exportConsultation.fetch(input);
    },
    async importConsultation(input) {
      const projectId = requireScopedGoalIntake(
        goalIntakes,
        input.intakeId,
        activeProjectId
      );
      const updated = await executeGoalIntakeMutation(
        () => importGoalConsultation.mutateAsync(input),
        projectId
      );
      syncGoalIntake(updated);
      return updated;
    },
    async approve(input) {
      const projectId = requireScopedGoalIntake(
        goalIntakes,
        input.intakeId,
        activeProjectId
      );
      const updated = await executeGoalIntakeMutation(
        () => approveGoalIntake.mutateAsync(input),
        projectId
      );
      syncGoalIntake(updated);
      await utils.supervisorRuns.list.invalidate();
      toast.success(
        updated.convertedRunId
          ? `Goal approved and converted to run ${updated.convertedRunId}`
          : "Goal contract approved"
      );
      return updated;
    },
    async convert(input) {
      const projectId = requireScopedGoalIntake(
        goalIntakes,
        input.intakeId,
        activeProjectId
      );
      const updated = await executeGoalIntakeMutation(
        () => convertGoalIntake.mutateAsync(input),
        projectId
      );
      syncGoalIntake(updated);
      await utils.supervisorRuns.list.invalidate();
      toast.success(
        updated.convertedRunId
          ? `Goal conversion resumed as run ${updated.convertedRunId}`
          : "Goal conversion resumed"
      );
      return updated;
    },
  };
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

  const openGoalComposer = () => {
    if (!activeProject) {
      return;
    }
    setGoalComposerProject({
      id: activeProject.id,
      name: activeProject.name,
    });
    setGoalComposerOpen(true);
  };

  const handleGoalComposerOpenChange = (open: boolean) => {
    setGoalComposerOpen(open);
    if (!open) {
      setGoalComposerProject(null);
    }
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
              onClick={openGoalComposer}
              size="sm"
              type="button"
            >
              <Plus className="size-3.5" /> New goal
            </Button>
            <Button
              className="gap-1.5"
              disabled={
                !activeProject ||
                runsQuery.isFetching ||
                goalIntakesQuery.isFetching ||
                profilesQuery.isFetching ||
                telegramStatus.isFetching
              }
              onClick={() => {
                runsQuery.refetch();
                goalIntakesQuery.refetch();
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

        <section className="flex flex-wrap items-end justify-between gap-3 rounded-xl border bg-card p-4">
          <div className="min-w-0">
            <label
              className="font-medium text-xs"
              htmlFor="mission-control-project"
            >
              Active project
            </label>
            <p className="mt-1 text-muted-foreground text-xs/relaxed">
              Every Goal, decision, count, and history entry below is scoped to
              exactly this project.
            </p>
          </div>
          <select
            aria-label="Active project for Mission Control"
            className="h-9 min-w-56 rounded-md border bg-background px-3 text-sm"
            id="mission-control-project"
            onChange={(event) => setActiveProjectId(event.target.value || null)}
            value={activeProjectId ?? ""}
          >
            <option value="">Select a project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </section>

        <ManagedGoalDiscoveryDialog
          onOpenChange={handleGoalComposerOpenChange}
          onSubmit={startGoalDiscovery}
          open={goalComposerOpen}
          project={goalComposerProject}
        />

        <div className="contents" hidden={!activeProject}>
          <section className="flex flex-wrap gap-2">
            <Stat label="Discovering goals" value={goalIntakes.length} />
            <Stat label="Awaiting approval" value={stats.approvals} />
            <Stat label="Waiting capacity" value={stats.capacity} />
            <Stat label="Open decisions" value={stats.decisions} />
            <Stat label="Active goals" value={stats.active} />
          </section>

          <section className="grid gap-3">
            <div>
              <h2 className="font-medium">Goal discovery</h2>
              <p className="text-muted-foreground text-xs">
                Interview, challenge, consult, and approve an exact Goal
                Contract before any managed run exists.
              </p>
            </div>
            <ManagedGoalIntakeCards
              actions={goalIntakeActions}
              error={goalIntakesQuery.error?.message}
              intakes={goalIntakes}
              loading={goalIntakesQuery.isLoading}
              projectName={activeProject?.name ?? "No project"}
            />
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
                const cancellation = getSupervisorCancellationPresentation(run);
                const goalContract = run.sourceGoalContract?.contract;
                const declaredChangeKinds = [
                  ...new Set(
                    run.tasks.flatMap((task) => valuesOrEmpty(task.changeKinds))
                  ),
                ];
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
                        <Button
                          aria-label={`Open ${getSupervisorRunTitle(run)} in Run Center`}
                          className="gap-1.5"
                          data-testid="mission-control-open-workspace"
                          onClick={() =>
                            navigate({
                              to: "/runs",
                              search: { runId: run.runId },
                            })
                          }
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <ExternalLink className="size-3.5" /> Open
                        </Button>
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
                            run.status === "needs_user" ||
                            cancellation?.requiresAttention
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {cancellation?.badgeLabel ??
                            run.status.replaceAll("_", " ")}
                        </Badge>
                        {!cancellation &&
                        (run.status === "queued" ||
                          run.status === "running") ? (
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
                        {!cancellation && run.status === "paused" ? (
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
                        {!cancellation && run.status === "needs_user" ? (
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
                            aria-label={`${cancellation?.actionLabel ?? "Cancel"} ${getSupervisorRunTitle(run)}`}
                            className="gap-1.5"
                            disabled={
                              pending ||
                              Boolean(cancellation && !cancellation.canRetry)
                            }
                            onClick={() => cancel.mutate({ runId: run.runId })}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            {cancellation ? (
                              <RotateCcw className="size-3.5" />
                            ) : (
                              <Square className="size-3.5" />
                            )}{" "}
                            {cancellation?.actionLabel ?? "Cancel"}
                          </Button>
                        )}
                      </div>
                    </div>

                    {cancellation ? (
                      <div
                        className={`mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                          cancellation.requiresAttention
                            ? "border-destructive/30 bg-destructive/5"
                            : "border-amber-500/30 bg-amber-500/5"
                        }`}
                      >
                        {cancellation.requiresAttention ? (
                          <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
                        ) : (
                          <Clock3 className="size-3.5 shrink-0 text-amber-500" />
                        )}
                        <span>{cancellation.message}</span>
                      </div>
                    ) : null}

                    {directBlocker ? (
                      <div className="mt-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
                        <Clock3 className="size-3.5 shrink-0 text-amber-500" />
                        <span>
                          Direct branch busy with{" "}
                          <strong>
                            {getSupervisorRunTitle(directBlocker)}
                          </strong>
                          . This run starts after that worker releases the
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
                            {run.plan.envelope.verificationCommands.length}{" "}
                            checks · {run.plan.hash.slice(0, 8)}
                          </div>
                        </div>
                        {goalContract ? (
                          <div className="mt-2 rounded-md border bg-background/60 p-2 text-muted-foreground">
                            <div>
                              Goal Contract {run.sourceGoalContract?.revisionId}{" "}
                              · {goalContract.acceptanceCriteria.length}{" "}
                              criteria
                            </div>
                            <div className="mt-1">
                              Declared change authority:{" "}
                              {declaredChangeKinds.length > 0
                                ? declaredChangeKinds
                                    .map((kind) => kind.replaceAll("_", " "))
                                    .join(", ")
                                : "read-only"}
                            </div>
                            <div className="mt-1">
                              Exact plan approval binds each task's criterion
                              IDs, change declarations, scope, and verification.
                            </div>
                          </div>
                        ) : null}
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
                              {decision.criterionIds?.length ? (
                                <div className="mt-1 text-muted-foreground text-xs">
                                  Criteria: {decision.criterionIds.join(", ")}
                                </div>
                              ) : null}
                              <div className="mt-2 flex gap-2">
                                <Input
                                  onChange={(event) =>
                                    setDrafts((current) => ({
                                      ...current,
                                      [decision.decisionId]: event.target.value,
                                    }))
                                  }
                                  placeholder={
                                    decision.kind === "goal_criteria_acceptance"
                                      ? "Review note; required when waiving"
                                      : "Answer this exception"
                                  }
                                  value={drafts[decision.decisionId] ?? ""}
                                />
                                {decision.kind ===
                                "goal_criteria_acceptance" ? (
                                  <>
                                    <Button
                                      disabled={pending}
                                      onClick={() =>
                                        answerDecision.mutate({
                                          runId: run.runId,
                                          decisionId: decision.decisionId,
                                          answer:
                                            (
                                              drafts[decision.decisionId] ?? ""
                                            ).trim() ||
                                            "Accepted after explicit user review.",
                                          criterionResolution: "accept",
                                          expectedRevision: run.revision,
                                        })
                                      }
                                      size="sm"
                                    >
                                      Accept
                                    </Button>
                                    <Button
                                      disabled={
                                        pending ||
                                        !(
                                          drafts[decision.decisionId] ?? ""
                                        ).trim()
                                      }
                                      onClick={() =>
                                        answerDecision.mutate({
                                          runId: run.runId,
                                          decisionId: decision.decisionId,
                                          answer: (
                                            drafts[decision.decisionId] ?? ""
                                          ).trim(),
                                          criterionResolution: "waive",
                                          expectedRevision: run.revision,
                                        })
                                      }
                                      size="sm"
                                      variant="outline"
                                    >
                                      Waive
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    disabled={
                                      pending ||
                                      !(
                                        drafts[decision.decisionId] ?? ""
                                      ).trim()
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
                                )}
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
                                <span className="font-medium">
                                  {task.title}
                                </span>
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
                              {valuesOrEmpty(task.criterionIds).length > 0 ? (
                                <div className="mt-1 text-muted-foreground">
                                  Criteria:{" "}
                                  {valuesOrEmpty(task.criterionIds).join(", ")}
                                </div>
                              ) : null}
                              {valuesOrEmpty(task.changeKinds).length > 0 ? (
                                <div className="mt-1 text-muted-foreground">
                                  Changes:{" "}
                                  {valuesOrEmpty(task.changeKinds)
                                    .map((kind) => kind.replaceAll("_", " "))
                                    .join(", ")}
                                </div>
                              ) : null}
                              {task.attempts.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {task.attempts.map((attempt, index) => (
                                    <Button
                                      className="h-7 gap-1.5 px-2 text-xs"
                                      key={attempt.attemptId}
                                      onClick={() =>
                                        navigate({
                                          to: "/",
                                          search: {
                                            chatId: attempt.chatId,
                                          },
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
        </div>
        <section
          className="rounded-xl border border-dashed bg-card/50 p-8 text-center"
          hidden={Boolean(activeProject)}
        >
          <Network className="mx-auto size-6 text-muted-foreground" />
          <h2 className="mt-3 font-medium text-sm">
            Select an active project first
          </h2>
          <p className="mx-auto mt-1 max-w-xl text-muted-foreground text-xs/relaxed">
            Mission Control never mixes Goals between projects. Choose a project
            above to load its discoveries, managed runs, decisions, counts, and
            history. New goal stays disabled until then.
          </p>
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
