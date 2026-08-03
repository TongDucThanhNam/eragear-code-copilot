import type {
  SupervisorFileManifest,
  SupervisorPatchArtifact,
  SupervisorRunState,
} from "../../domain/supervisor-run.schemas";

export interface PreparedWorkerWorkspace {
  workspaceId: string;
  kind: "read_only" | "isolated_git";
  userProjectRoot: string;
  projectRoot: string;
  baseHead?: string;
  targetFingerprints: Record<string, string>;
}

export interface CollectedWorkerPatch {
  workspace: PreparedWorkerWorkspace;
  artifact: SupervisorPatchArtifact;
  files: SupervisorFileManifest;
}

export interface WorkerWorkspacePort {
  prepare(input: {
    runId: string;
    taskId: string;
    attemptKey: string;
    projectRoot: string;
    executionMode: "read_only" | "write";
    filesAllowed: string[];
    baseSnapshot: SupervisorRunState["baseSnapshot"];
  }): Promise<PreparedWorkerWorkspace>;
  collect(workspace: PreparedWorkerWorkspace): Promise<CollectedWorkerPatch>;
  apply(input: {
    workspace: PreparedWorkerWorkspace;
    artifact: SupervisorPatchArtifact;
  }): Promise<void>;
  fingerprint(input: {
    projectRoot: string;
    relativePaths: string[];
  }): Promise<Record<string, string>>;
  dispose(workspace: PreparedWorkerWorkspace): Promise<void>;
}
