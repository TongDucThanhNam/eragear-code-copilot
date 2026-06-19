/**
 * Background Processing Types
 *
 * Shared contracts for recurring async task execution.
 *
 * @module shared/types/background.types
 */

export interface BackgroundTaskResult {
  [key: string]: string | number | boolean | null | undefined;
}

export interface BackgroundTaskSpec {
  name: string;
  intervalMs: number;
  timeoutMs?: number;
  run:
    | (() => Promise<BackgroundTaskResult | undefined>)
    | (() => BackgroundTaskResult | undefined);
}

export interface BackgroundTaskState {
  name: string;
  intervalMs: number;
  timeoutMs: number;
  running: boolean;
  lastStartedAt?: number;
  lastFinishedAt?: number;
  lastDurationMs?: number;
  successCount: number;
  failureCount: number;
  lastError?: string;
  lastResult?: BackgroundTaskResult;
}

export interface BackgroundRunnerState {
  enabled: boolean;
  startedAt?: number;
  tickMs: number;
  tasks: BackgroundTaskState[];
}
