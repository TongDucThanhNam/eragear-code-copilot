import { ENV } from "#runtime/config/environment";
import type { SupervisorWorkflowRuntimeTickResult } from "#runtime/modules/supervisor-orchestration";
import type { BackgroundTaskSpec } from "#runtime/shared/types/background.types";

export interface WorkflowReconcileDispatchPort {
  tick(): Promise<SupervisorWorkflowRuntimeTickResult>;
}

export function createWorkflowReconcileDispatchTask(input: {
  runtime: WorkflowReconcileDispatchPort;
}): BackgroundTaskSpec {
  return {
    name: "workflow-reconcile-dispatch",
    intervalMs: ENV.backgroundTickMs,
    timeoutMs: ENV.backgroundTaskTimeoutMs,
    run: async () => {
      const result = await input.runtime.tick();
      return { ...result };
    },
  };
}
