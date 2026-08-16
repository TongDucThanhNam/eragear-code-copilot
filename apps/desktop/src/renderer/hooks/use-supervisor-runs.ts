import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
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

export function useSupervisorRuns(chatId: string) {
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
    runs: selectSupervisorRunsForChat(query.data, chatId),
    isLoading: query.isLoading,
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
    canStart: Boolean(activeProject),
    start: async (intent: string) => {
      if (!activeProject) {
        throw new Error("Select a project before starting a supervised run");
      }
      return await start.mutateAsync({
        projectId: activeProject.id,
        intent,
        constraints: [],
        priority: "normal",
      });
    },
    approvePlan: async (run: SupervisorRunClientUpdate) => {
      if (!run.plan) {
        throw new Error("Run has no plan awaiting approval");
      }
      const updated = await approvePlan.mutateAsync({
        runId: run.runId,
        planVersion: run.plan.version,
        planHash: run.plan.hash,
        expectedRevision: run.revision,
      });
      toast.success("Supervisor plan approved");
      return updated;
    },
    requestPlanChanges: (
      run: SupervisorRunClientUpdate,
      requestedChanges: string
    ) =>
      requestPlanChanges.mutateAsync({
        runId: run.runId,
        requestedChanges,
        expectedRevision: run.revision,
      }),
    answerDecision: (
      runId: string,
      decisionId: string,
      answer: string,
      expectedRevision: number
    ) =>
      answerDecision.mutateAsync({
        runId,
        decisionId,
        answer,
        expectedRevision,
      }),
    setPriority: (
      runId: string,
      priority: SupervisorRunClientUpdate["priority"],
      expectedRevision: number
    ) => setPriority.mutateAsync({ runId, priority, expectedRevision }),
    pause: (runId: string) => pause.mutateAsync({ runId }),
    resume: (runId: string) => resume.mutateAsync({ runId }),
    cancel: (runId: string) => cancel.mutateAsync({ runId }),
    replan: (runId: string) => replan.mutateAsync({ runId }),
    retryTask: async (runId: string, taskId: string) => {
      const updated = await retryTask.mutateAsync({ runId, taskId });
      toast.success(
        updated.status === "queued" ? "Task queued for retry" : "Task retried"
      );
      return updated;
    },
    approveGate: async (runId: string, gateId: string) => {
      const updated = await approveGate.mutateAsync({ runId, gateId });
      toast.success("Supervisor gate approved");
      return updated;
    },
    rejectGate: (runId: string, gateId: string) =>
      rejectGate.mutateAsync({ runId, gateId }),
  };
}
