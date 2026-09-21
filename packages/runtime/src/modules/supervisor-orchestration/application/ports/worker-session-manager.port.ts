import type { SupervisorWorkerAttempt } from "../../domain/supervisor-run.schemas";
import type { PreparedSupervisorPrompt } from "./supervisor-effect-prompt-dispatch.port";
import type { PreparedWorkerWorkspace } from "./worker-workspace.port";

export interface DispatchSupervisorWorkerInput {
  runId: string;
  userId: string;
  taskId: string;
  idempotencyKey: string;
  preparedPrompt: PreparedSupervisorPrompt;
  isolatedProjectRoot?: string;
  workspace?: PreparedWorkerWorkspace;
}

export interface ResumeSupervisorWorkerInput {
  runId: string;
  userId: string;
  taskId: string;
  attemptId: string;
  preparedPrompt: PreparedSupervisorPrompt;
}

export interface DispatchSupervisorWorkerResult {
  attempt: SupervisorWorkerAttempt;
  alreadyDispatched: boolean;
}

export interface SupervisorWorkerBinding {
  runId: string;
  taskId: string;
  attemptId: string;
  userId: string;
  chatId: string;
  turnId?: string;
}

export interface WorkerSessionManagerPort {
  dispatch(
    input: DispatchSupervisorWorkerInput
  ): Promise<DispatchSupervisorWorkerResult>;
  findBinding(input: {
    userId: string;
    chatId: string;
    turnId?: string;
  }): Promise<SupervisorWorkerBinding | null>;
  claimCompletedTurn(input: {
    userId: string;
    chatId: string;
    turnId: string;
  }): Promise<SupervisorWorkerBinding | null>;
  claimTerminalDecision(input: {
    userId: string;
    chatId: string;
    eventId: string;
  }): Promise<SupervisorWorkerBinding | null>;
  claimStoppedSession(input: {
    userId: string;
    chatId: string;
    eventId: string;
  }): Promise<SupervisorWorkerBinding | null>;
  stop(input: {
    runId: string;
    userId: string;
    taskId: string;
    attemptId: string;
  }): Promise<void>;
  release(input: {
    runId: string;
    userId: string;
    taskId: string;
    attemptId: string;
  }): Promise<void>;
  resume(input: ResumeSupervisorWorkerInput): Promise<void>;
  resumePendingCapacity(input: ResumeSupervisorWorkerInput): Promise<void>;
}
