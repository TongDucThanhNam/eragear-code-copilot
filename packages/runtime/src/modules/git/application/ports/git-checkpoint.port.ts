import type {
  GitCheckpoint,
  GitCheckpointKind,
  GitTurnCheckpoint,
  GitTurnCheckpointKind,
  TurnDiffFile,
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

export interface GitTurnCheckpointCaptureParams {
  projectRoot: string;
  sessionId: string;
  turnId?: string;
  turnCount: number;
  kind: GitTurnCheckpointKind;
}

export interface GitTurnCheckpointDiffParams {
  projectRoot: string;
  fromRef: string;
  toRef: string;
  ignoreWhitespace?: boolean;
}

export interface GitTurnCheckpointRestoreParams {
  projectRoot: string;
  targetRef: string;
  fallbackToHead?: boolean;
}

export interface GitTurnCheckpointRestoreResult {
  restoredRef: string;
  safetyRef: string;
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
  captureTurnCheckpoint(
    params: GitTurnCheckpointCaptureParams
  ): Promise<GitTurnCheckpoint>;
  listTurnCheckpoints(params: {
    projectRoot: string;
    sessionId: string;
  }): Promise<GitTurnCheckpoint[]>;
  diffTurnCheckpoints(
    params: GitTurnCheckpointDiffParams
  ): Promise<TurnDiffFile[]>;
  restoreTurnCheckpoint(
    params: GitTurnCheckpointRestoreParams
  ): Promise<GitTurnCheckpointRestoreResult>;
  deleteTurnCheckpointsAfter(params: {
    projectRoot: string;
    sessionId: string;
    turnCount: number;
  }): Promise<{ deletedRefs: string[] }>;
}
