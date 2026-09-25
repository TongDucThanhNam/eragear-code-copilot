import type {
  SupervisorRunClientUpdate,
  SupervisorRunDetailClientView,
} from "@eragear-code-copilot/shared";
import { useCallback } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/store/project-store";

const RUN_LIST_INPUT = { includeTerminal: true } as const;

export function upsertSupervisorRun(
  current: SupervisorRunClientUpdate[] | undefined,
  update: SupervisorRunClientUpdate
): SupervisorRunClientUpdate[] {
  const existing = current ?? [];
  const previous = existing.find((run) => run.runId === update.runId);
  if (previous && previous.revision > update.revision) {
    return existing;
  }
  return [update, ...existing.filter((run) => run.runId !== update.runId)].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function selectSupervisorRunsForChat(
  runs: SupervisorRunClientUpdate[] | undefined,
  chatId: string
): SupervisorRunClientUpdate[] {
  return (runs ?? []).filter(
    (run) => !run.originatingChatId || run.originatingChatId === chatId
  );
}

/**
 * The deep, bounded detail projection for one run. Kept separate from the
 * compact list: the workspace deepens only the run the user actually opens.
 * `isStale` lets the consumer avoid showing deep evidence that lags the live
 * compact state — the compact projection stays authoritative for status.
 */
export function useSupervisorRunDetail(runId: string | null) {
  const query = trpc.supervisorRuns.detail.useQuery(
    { runId: runId ?? "" },
    {
      enabled: Boolean(runId),
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 5000,
    }
  );
  return {
    detail: query.data ?? null,
    isLoading: query.isPending,
    isFetching: query.isFetching,
    error: query.error?.message ?? null,
    refetch: useCallback(() => {
      query.refetch().catch(() => undefined);
    }, [query]),
  };
}

/** True when the deep view lags the live compact run; status stays compact-authoritative. */
export function isSupervisorRunDetailStale(
  detail: SupervisorRunDetailClientView | null,
  run: SupervisorRunClientUpdate | undefined
): boolean {
  if (!(detail && run)) {
    return false;
  }
  return detail.revision < run.revision;
}

/**
 * A rejected authority action must be visible to the user, not swallowed by a
 * silent catch: toast the runtime's reason, then rethrow for callers that
 * react to the failure.
 */
async function reportActionFailure<T>(
  label: string,
  action: () => Promise<T>
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast.error(`${label} failed: ${message}`);
    throw error;
  }
}

export function useSupervisorRunsCore() {
  const utils = trpc.useUtils();
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? null;
  const query = trpc.supervisorRuns.list.useQuery(RUN_LIST_INPUT, {
    refetchOnWindowFocus: false,
    retry: false,
  });
  const updateCachedRun = useCallback(
    (update: SupervisorRunClientUpdate) => {
      utils.supervisorRuns.list.setData(RUN_LIST_INPUT, (current) =>
        upsertSupervisorRun(current, update)
      );
      utils.supervisorRuns.detail.invalidate().catch(() => undefined);
    },
    [utils]
  );
  trpc.supervisorRuns.updates.useSubscription(undefined, {
    onData: updateCachedRun,
  });
  const mutationOptions = {
    onSuccess: updateCachedRun,
    onError: (error: { message?: string }) =>
      toast.error(error.message || "Supervisor action failed"),
  };
  const start = trpc.supervisorRuns.createDraft.useMutation(mutationOptions);
  const approvePlan =
    trpc.supervisorRuns.approvePlan.useMutation(mutationOptions);
  const requestPlanChanges =
    trpc.supervisorRuns.requestPlanChanges.useMutation(mutationOptions);
  const answerDecision =
    trpc.supervisorRuns.answerDecision.useMutation(mutationOptions);
  const setPriority =
    trpc.supervisorRuns.setPriority.useMutation(mutationOptions);
  const pause = trpc.supervisorRuns.pause.useMutation(mutationOptions);
  const resume = trpc.supervisorRuns.resume.useMutation(mutationOptions);
  const cancel = trpc.supervisorRuns.cancel.useMutation(mutationOptions);
  const replan = trpc.supervisorRuns.replan.useMutation(mutationOptions);
  const retryTask = trpc.supervisorRuns.retryTask.useMutation(mutationOptions);
  const approveGate =
    trpc.supervisorRuns.approveGate.useMutation(mutationOptions);
  const rejectGate =
    trpc.supervisorRuns.rejectGate.useMutation(mutationOptions);

  return {
    /** Every run the user owns across chats, newest update first. */
    runs: query.data ?? [],
    isLoading: query.isPending,
    error: query.error?.message ?? null,
    isPending:
      start.isPending ||
      approvePlan.isPending ||
      requestPlanChanges.isPending ||
      answerDecision.isPending ||
      setPriority.isPending ||
      pause.isPending ||
      resume.isPending ||
      cancel.isPending ||
      replan.isPending ||
      retryTask.isPending ||
      approveGate.isPending ||
      rejectGate.isPending,
    updateCachedRun,
    canStart: Boolean(activeProject),
    start: async (intent: string, projectId?: string) => {
      const targetProjectId = projectId ?? activeProject?.id;
      if (!targetProjectId) {
        throw new Error("Select a project before starting a supervised run");
      }
      return await reportActionFailure("Start run", () =>
        start.mutateAsync({
          projectId: targetProjectId,
          intent,
          constraints: [],
          priority: "normal",
        })
      );
    },
    approvePlan: async (run: SupervisorRunClientUpdate) => {
      const plan = run.plan;
      if (!plan) {
        throw new Error("Run has no plan awaiting approval");
      }
      const updated = await reportActionFailure("Approve plan", () =>
        approvePlan.mutateAsync({
          runId: run.runId,
          planVersion: plan.version,
          planHash: plan.hash,
          expectedRevision: run.revision,
        })
      );
      toast.success("Supervisor plan approved");
      return updated;
    },
    requestPlanChanges: (
      run: SupervisorRunClientUpdate,
      requestedChanges: string
    ) =>
      reportActionFailure("Request plan changes", () =>
        requestPlanChanges.mutateAsync({
          runId: run.runId,
          requestedChanges,
          expectedRevision: run.revision,
        })
      ),
    answerDecision: (
      runId: string,
      decisionId: string,
      answer: string,
      expectedRevision: number,
      criterionResolution?: "accept" | "waive"
    ) =>
      reportActionFailure("Answer decision", () =>
        answerDecision.mutateAsync({
          runId,
          decisionId,
          answer,
          ...(criterionResolution ? { criterionResolution } : {}),
          expectedRevision,
        })
      ),
    setPriority: (
      runId: string,
      priority: SupervisorRunClientUpdate["priority"],
      expectedRevision: number
    ) =>
      reportActionFailure("Set priority", () =>
        setPriority.mutateAsync({ runId, priority, expectedRevision })
      ),
    pause: (runId: string) =>
      reportActionFailure("Pause run", () => pause.mutateAsync({ runId })),
    resume: (runId: string) =>
      reportActionFailure("Resume run", () => resume.mutateAsync({ runId })),
    cancel: (runId: string) =>
      reportActionFailure("Cancel run", () => cancel.mutateAsync({ runId })),
    replan: (runId: string) =>
      reportActionFailure("Replan run", () => replan.mutateAsync({ runId })),
    retryTask: async (runId: string, taskId: string) => {
      const updated = await reportActionFailure("Retry task", () =>
        retryTask.mutateAsync({ runId, taskId })
      );
      toast.success(
        updated.status === "queued" ? "Task queued for retry" : "Task retried"
      );
      return updated;
    },
    approveGate: async (runId: string, gateId: string) => {
      const updated = await reportActionFailure("Approve gate", () =>
        approveGate.mutateAsync({ runId, gateId })
      );
      toast.success("Supervisor gate approved");
      return updated;
    },
    rejectGate: (runId: string, gateId: string) =>
      reportActionFailure("Reject gate", () =>
        rejectGate.mutateAsync({ runId, gateId })
      ),
  };
}

export function useSupervisorRuns(chatId: string) {
  const core = useSupervisorRunsCore();
  return {
    ...core,
    runs: selectSupervisorRunsForChat(core.runs, chatId),
  };
}
