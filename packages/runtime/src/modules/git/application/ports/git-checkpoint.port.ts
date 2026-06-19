import type {
  GitCheckpoint,
  GitCheckpointKind,
} from "../contracts/git.contract";

export interface GitCheckpointCreateParams {
  projectRoot: string;
  projectId?: string;
  projectName?: string;
  name?: string;
  kind: GitCheckpointKind;
  chatId?: string;
  agentSessionId?: string;
  turnId?: string;
}

export interface GitCheckpointRestoreParams {
  projectRoot: string;
  checkpointId: string;
}

export interface GitCheckpointRestorePortResult {
  checkpoint: GitCheckpoint;
  safetyCheckpoint?: GitCheckpoint;
  restoredAt: string;
}

/**
 * Git-backed checkpoint adapter.
 *
 * Security invariant: implementations must scope all Git and filesystem IO to
 * `projectRoot` and persist checkpoint data under the project data directory.
 */
export interface GitCheckpointPort {
  createCheckpoint(params: GitCheckpointCreateParams): Promise<GitCheckpoint>;
  listCheckpoints(params: {
    projectRoot: string;
    limit?: number;
  }): Promise<GitCheckpoint[]>;
  restoreCheckpoint(
    params: GitCheckpointRestoreParams
  ): Promise<GitCheckpointRestorePortResult>;
}
