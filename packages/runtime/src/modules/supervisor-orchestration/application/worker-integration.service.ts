import type {
  SupervisorRunState,
  SupervisorTaskRecord,
  SupervisorWorkerResult,
} from "../domain/supervisor-run.schemas";
import type {
  CollectedWorkerPatch,
  PreparedWorkerWorkspace,
  WorkerWorkspacePort,
} from "./ports/worker-workspace.port";
import {
  evaluateWorkerIntegrationGate,
  type WorkerIntegrationGateDecision,
} from "./worker-integration-gate";

export class WorkerIntegrationService {
  private readonly workspaces: WorkerWorkspacePort;

  constructor(workspaces: WorkerWorkspacePort) {
    this.workspaces = workspaces;
  }

  async integrate(input: {
    run: SupervisorRunState;
    task: SupervisorTaskRecord;
    workspace: PreparedWorkerWorkspace;
    patch?: CollectedWorkerPatch;
    result: SupervisorWorkerResult;
    destructiveActions?: string[];
    approvedGateKinds?: SupervisorRunState["gates"][number]["kind"][];
  }): Promise<WorkerIntegrationGateDecision> {
    try {
      const touchedPaths =
        input.patch?.files.touched ?? input.result.files.touched;
      const currentFingerprints = await this.workspaces.fingerprint({
        projectRoot: input.run.projectRoot,
        relativePaths: touchedPaths,
      });
      const evaluatedGate = evaluateWorkerIntegrationGate({
        ...input,
        currentFingerprints,
      });
      const approved = new Set(input.approvedGateKinds ?? []);
      const remainingReasons = evaluatedGate.reasons.filter(
        (reason) => !approved.has(mapReasonToGateKind(reason))
      );
      const gate: WorkerIntegrationGateDecision =
        remainingReasons.length === 0
          ? { decision: "allow", reasons: [] }
          : { decision: "needs_user", reasons: remainingReasons };
      if (
        gate.decision !== "allow" ||
        input.task.executionMode === "read_only"
      ) {
        return gate;
      }
      if (!input.patch) {
        return { decision: "needs_user", reasons: ["patch_missing"] };
      }
      try {
        await this.workspaces.apply({
          workspace: input.workspace,
          artifact: input.patch.artifact,
        });
      } catch {
        return { decision: "needs_user", reasons: ["conflict"] };
      }
      return gate;
    } finally {
      await this.workspaces.dispose(input.workspace);
    }
  }
}

function mapReasonToGateKind(
  reason: WorkerIntegrationGateDecision["reasons"][number]
): SupervisorRunState["gates"][number]["kind"] {
  switch (reason) {
    case "scope_drift":
      return "scope";
    case "dirty_path_overlap":
      return "dirty_overlap";
    case "baseline_drift":
      return "baseline_drift";
    case "file_deleted":
      return "deletion";
    case "destructive_action":
      return "destructive_action";
    case "conflict":
      return "conflict";
    default:
      return "verification";
  }
}
