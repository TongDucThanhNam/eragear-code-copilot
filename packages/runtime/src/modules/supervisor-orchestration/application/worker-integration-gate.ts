import type {
  SupervisorRunState,
  SupervisorTaskRecord,
  SupervisorWorkerResult,
} from "../domain/supervisor-run.schemas";
import type {
  CollectedWorkerPatch,
  PreparedWorkerWorkspace,
} from "./ports/worker-workspace.port";

const TRAILING_SLASH = /\/$/;
const LEADING_CURRENT_DIR = /^\.\//;

export type WorkerIntegrationGateReason =
  | "scope_drift"
  | "dirty_path_overlap"
  | "baseline_drift"
  | "file_deleted"
  | "destructive_action"
  | "verification_failed"
  | "patch_missing"
  | "tool_failure"
  | "unresolved_permission"
  | "conflict";

export type WorkerIntegrationGateDecision =
  | { decision: "allow"; reasons: [] }
  | { decision: "needs_user"; reasons: WorkerIntegrationGateReason[] };

export function evaluateWorkerIntegrationGate(input: {
  run: SupervisorRunState;
  task: SupervisorTaskRecord;
  workspace: PreparedWorkerWorkspace;
  patch?: CollectedWorkerPatch;
  result: SupervisorWorkerResult;
  currentFingerprints: Record<string, string>;
  destructiveActions?: string[];
}): WorkerIntegrationGateDecision {
  const reasons = new Set<WorkerIntegrationGateReason>();
  const files = input.patch?.files ?? input.result.files;
  if (
    files.touched.some(
      (filePath) =>
        !input.task.filesAllowed.some((allowedPath) =>
          pathIsAllowed(filePath, allowedPath)
        )
    )
  ) {
    reasons.add("scope_drift");
  }
  if (
    input.workspace.kind !== "direct_git" &&
    files.touched.some((filePath) =>
      input.run.baseSnapshot.dirtyPaths.some((dirtyPath) =>
        pathsOverlap(filePath, dirtyPath)
      )
    )
  ) {
    reasons.add("dirty_path_overlap");
  }
  if (
    input.workspace.kind !== "direct_git" &&
    files.touched.some((filePath) => {
      const dispatchFingerprint = input.workspace.targetFingerprints[filePath];
      const currentFingerprint = input.currentFingerprints[filePath];
      return (
        !(dispatchFingerprint && currentFingerprint) ||
        dispatchFingerprint !== currentFingerprint
      );
    })
  ) {
    reasons.add("baseline_drift");
  }
  if (files.deleted.length > 0) {
    reasons.add("file_deleted");
  }
  if ((input.destructiveActions?.length ?? 0) > 0) {
    reasons.add("destructive_action");
  }
  if (input.task.executionMode === "write" && !input.patch?.artifact) {
    reasons.add("patch_missing");
  }
  if (
    input.task.verificationCommands.some((command) => {
      const evidence = input.result.verification.find(
        (item) => item.command === command
      );
      return !evidence || evidence.exitCode !== 0;
    })
  ) {
    reasons.add("verification_failed");
  }
  if (input.result.toolFailureSummary.length > 0) {
    reasons.add("tool_failure");
  }
  if (input.result.unresolvedPermissions.length > 0) {
    reasons.add("unresolved_permission");
  }
  return reasons.size === 0
    ? { decision: "allow", reasons: [] }
    : { decision: "needs_user", reasons: [...reasons].sort() };
}

function pathIsAllowed(filePath: string, allowedPath: string): boolean {
  const file = normalizePath(filePath);
  const allowed = normalizePath(allowedPath).replace(TRAILING_SLASH, "");
  return file === allowed || file.startsWith(`${allowed}/`);
}

function pathsOverlap(leftPath: string, rightPath: string): boolean {
  return (
    pathIsAllowed(leftPath, rightPath) || pathIsAllowed(rightPath, leftPath)
  );
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(LEADING_CURRENT_DIR, "");
}

export const __workerIntegrationGateInternals = { pathIsAllowed, pathsOverlap };
