import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { z } from "zod";
import { AppSidebar } from "@/components/left-sidebar/app-sidebar";
import { RunCenter } from "@/components/run-center/run-center";
import type { RunWorkspaceActions } from "@/components/run-center/run-workspace";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import {
  isSupervisorRunDetailStale,
  useSupervisorRunDetail,
  useSupervisorRunsCore,
} from "@/hooks/use-supervisor-runs";

export const Route = createFileRoute("/runs")({
  validateSearch: z.object({
    runId: z.string().optional(),
  }),
  component: RunCenterPage,
});

function RunCenterPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { runId } = useSearch({ from: Route.fullPath });
  const controller = useSupervisorRunsCore();
  const detailQuery = useSupervisorRunDetail(runId ?? null);
  const selectedRun = controller.runs.find((run) => run.runId === runId);
  const actions: RunWorkspaceActions = {
    isPending: controller.isPending,
    pause: (runIdToActOn) => controller.pause(runIdToActOn),
    resume: (runIdToActOn) => controller.resume(runIdToActOn),
    cancel: (runIdToActOn) => controller.cancel(runIdToActOn),
    replan: (runIdToActOn) => controller.replan(runIdToActOn),
    retryTask: (runIdToActOn, taskId) =>
      controller.retryTask(runIdToActOn, taskId),
    approvePlan: (run) => controller.approvePlan(run),
    requestPlanChanges: (run, note) => controller.requestPlanChanges(run, note),
    answerDecision: (
      id,
      decisionId,
      answer,
      expectedRevision,
      criterionResolution
    ) =>
      controller.answerDecision(
        id,
        decisionId,
        answer,
        expectedRevision,
        criterionResolution
      ),
    approveGate: (id, gateId) => controller.approveGate(id, gateId),
    rejectGate: (id, gateId) => controller.rejectGate(id, gateId),
    setPriority: (id, priority, expectedRevision) =>
      controller.setPriority(id, priority, expectedRevision),
  };
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <SidebarProvider
        className="min-h-0 flex-1 overflow-hidden"
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
          } as React.CSSProperties
        }
      >
        <AppSidebar variant="sidebar" />
        <SidebarInset className="min-h-0 overflow-hidden">
          <RunCenter
            actions={actions}
            detail={detailQuery.detail}
            detailError={detailQuery.error}
            detailLoading={detailQuery.isLoading}
            detailStale={isSupervisorRunDetailStale(
              detailQuery.detail,
              selectedRun
            )}
            error={controller.error}
            isLoading={controller.isLoading}
            onOpenWorkerChat={(workerChatId) =>
              navigate({ to: "/", search: { chatId: workerChatId } })
            }
            onSelectRun={(nextRunId) =>
              navigate({ search: nextRunId ? { runId: nextRunId } : {} })
            }
            runs={controller.runs}
            selectedRunId={runId ?? null}
          />
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
