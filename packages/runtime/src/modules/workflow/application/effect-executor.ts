import { randomUUID } from "node:crypto";
import type {
  WorkflowEffectRecord,
  WorkflowJsonValue,
} from "./contracts/workflow-journal.contract";
import type { WorkflowJournalPort } from "./ports/workflow-journal.port";

const DEFAULT_LEASE_DURATION_MS = 60_000;
const DEFAULT_BATCH_SIZE = 100;

export type WorkflowEffectHandlerResult =
  | {
      outcome: "succeeded";
      resultEventId?: string;
      result?: WorkflowJsonValue;
    }
  | {
      outcome: "failed";
      error: WorkflowJsonValue;
      resultEventId?: string;
      result?: WorkflowJsonValue;
    }
  | {
      outcome: "uncertain";
      error: WorkflowJsonValue;
      result?: WorkflowJsonValue;
    };

export interface WorkflowEffectHandlerInput {
  effect: WorkflowEffectRecord;
  claimToken: string;
}

export type WorkflowEffectHandler = (
  input: WorkflowEffectHandlerInput
) => WorkflowEffectHandlerResult | Promise<WorkflowEffectHandlerResult>;

export type WorkflowEffectHandlers = Readonly<
  Record<string, WorkflowEffectHandler | undefined>
>;

export class WorkflowEffectUncertainError extends Error {
  readonly detail: WorkflowJsonValue;

  constructor(
    detail: WorkflowJsonValue,
    message = "Workflow effect outcome is uncertain"
  ) {
    super(message);
    this.name = "WorkflowEffectUncertainError";
    this.detail = detail;
  }
}

export type WorkflowEffectExecutionResult =
  | {
      effectId: string;
      effectType: string;
      outcome: "succeeded" | "failed" | "uncertain";
      effect: WorkflowEffectRecord;
    }
  | {
      effectId: string;
      effectType: string;
      outcome: "cas_conflict";
      phase: "start" | "finish";
      attemptedOutcome: "started" | "succeeded" | "failed" | "uncertain";
    }
  | {
      effectId: string;
      effectType: string;
      outcome: "journal_error";
      phase: "start" | "finish";
      error: WorkflowJsonValue;
    };

export interface WorkflowEffectExecutorResult {
  claimToken: string;
  claimedEffectIds: string[];
  effects: WorkflowEffectExecutionResult[];
}

export interface ExecuteDueWorkflowEffectsInput {
  nowMs?: number;
  leaseDurationMs?: number;
  limit?: number;
}

export interface CommitWorkflowEffectHandlerResultInput {
  effect: WorkflowEffectRecord;
  claimToken: string;
  finishedAtMs: number;
  result: WorkflowEffectHandlerResult;
}

export type WorkflowEffectHandlerResultCommitter = (
  input: CommitWorkflowEffectHandlerResultInput
) => Promise<WorkflowEffectRecord | null>;

export type WorkflowClaimedEffectBoundary = (
  input: {
    effect: WorkflowEffectRecord;
    claimToken: string;
  },
  execute: () => Promise<WorkflowEffectExecutionResult>
) => Promise<WorkflowEffectExecutionResult>;

export interface EffectExecutorDeps {
  journal: WorkflowJournalPort;
  handlers: WorkflowEffectHandlers;
  commitHandlerResult?: WorkflowEffectHandlerResultCommitter;
  executeClaimedEffect?: WorkflowClaimedEffectBoundary;
  now?: () => number;
  createClaimToken?: () => string;
  leaseDurationMs?: number;
  batchSize?: number;
}

export class EffectExecutor {
  private readonly journal: WorkflowJournalPort;
  private readonly handlers: ReadonlyMap<string, WorkflowEffectHandler>;
  private readonly commitHandlerResult?: WorkflowEffectHandlerResultCommitter;
  private readonly claimedEffectBoundary?: WorkflowClaimedEffectBoundary;
  private readonly now: () => number;
  private readonly createClaimToken: () => string;
  private readonly leaseDurationMs: number;
  private readonly batchSize: number;

  constructor(deps: EffectExecutorDeps) {
    this.journal = deps.journal;
    this.handlers = new Map(
      Object.entries(deps.handlers).filter(
        (entry): entry is [string, WorkflowEffectHandler] =>
          entry[1] !== undefined
      )
    );
    this.commitHandlerResult = deps.commitHandlerResult;
    this.claimedEffectBoundary = deps.executeClaimedEffect;
    this.now = deps.now ?? Date.now;
    this.createClaimToken =
      deps.createClaimToken ?? (() => `workflow-effect-claim-${randomUUID()}`);
    this.leaseDurationMs = deps.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    this.batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  async executeDueEffects(
    input: ExecuteDueWorkflowEffectsInput = {}
  ): Promise<WorkflowEffectExecutorResult> {
    const nowMs = input.nowMs ?? this.now();
    const leaseDurationMs = input.leaseDurationMs ?? this.leaseDurationMs;
    const claimToken = this.createClaimToken();
    const claimed = await this.journal.claimDueEffects({
      nowMs,
      claimToken,
      leaseDurationMs,
      limit: input.limit ?? this.batchSize,
    });
    const effects: WorkflowEffectExecutionResult[] = [];

    for (const effect of claimed) {
      effects.push(
        await this.executeClaimedEffect(effect, claimToken, leaseDurationMs)
      );
    }

    return {
      claimToken,
      claimedEffectIds: claimed.map((effect) => effect.effectId),
      effects,
    };
  }

  private async executeClaimedEffect(
    claimed: WorkflowEffectRecord,
    claimToken: string,
    leaseDurationMs: number
  ): Promise<WorkflowEffectExecutionResult> {
    const startedAtMs = Math.max(claimed.claimedAtMs ?? 0, this.now());
    let started: WorkflowEffectRecord | null;
    try {
      started = await this.journal.markEffectStarted({
        effectId: claimed.effectId,
        claimToken,
        startedAtMs,
        leaseExpiresAtMs: addDuration(startedAtMs, leaseDurationMs),
      });
    } catch (error) {
      return journalErrorResult(claimed, "start", error);
    }
    if (!started) {
      return {
        effectId: claimed.effectId,
        effectType: claimed.effectType,
        outcome: "cas_conflict",
        phase: "start",
        attemptedOutcome: "started",
      };
    }

    const execute = () => this.finishStartedEffect(started, claimToken);
    return this.claimedEffectBoundary
      ? await this.claimedEffectBoundary(
          { effect: started, claimToken },
          execute
        )
      : await execute();
  }

  private async finishStartedEffect(
    started: WorkflowEffectRecord,
    claimToken: string
  ): Promise<WorkflowEffectExecutionResult> {
    const handlerResult = await this.invokeHandler(started, claimToken);
    const startedAtMs = started.startedAtMs ?? this.now();
    const finishedAtMs = Math.max(startedAtMs, this.now());
    try {
      const persisted = await this.persistHandlerResult(
        started,
        claimToken,
        finishedAtMs,
        handlerResult
      );
      if (!persisted) {
        return {
          effectId: started.effectId,
          effectType: started.effectType,
          outcome: "cas_conflict",
          phase: "finish",
          attemptedOutcome: handlerResult.outcome,
        };
      }
      return {
        effectId: persisted.effectId,
        effectType: persisted.effectType,
        outcome: handlerResult.outcome,
        effect: persisted,
      };
    } catch (error) {
      return journalErrorResult(started, "finish", error);
    }
  }

  private async invokeHandler(
    effect: WorkflowEffectRecord,
    claimToken: string
  ): Promise<WorkflowEffectHandlerResult> {
    const handler = this.handlers.get(effect.effectType);
    if (!handler) {
      return {
        outcome: "failed",
        error: {
          code: "WORKFLOW_EFFECT_HANDLER_NOT_FOUND",
          effectType: effect.effectType,
        },
      };
    }

    try {
      return await handler({ effect, claimToken });
    } catch (error) {
      if (error instanceof WorkflowEffectUncertainError) {
        return { outcome: "uncertain", error: error.detail };
      }
      return {
        outcome: "failed",
        error: serializeError(error, "WORKFLOW_EFFECT_HANDLER_FAILED"),
      };
    }
  }

  private persistHandlerResult(
    effect: WorkflowEffectRecord,
    claimToken: string,
    finishedAtMs: number,
    result: WorkflowEffectHandlerResult
  ): Promise<WorkflowEffectRecord | null> {
    if (this.commitHandlerResult) {
      return this.commitHandlerResult({
        effect,
        claimToken,
        finishedAtMs,
        result,
      });
    }
    switch (result.outcome) {
      case "succeeded":
        return this.journal.markEffectSucceeded({
          effectId: effect.effectId,
          claimToken,
          finishedAtMs,
          ...(result.resultEventId
            ? { resultEventId: result.resultEventId }
            : {}),
        });
      case "failed":
        return this.journal.markEffectFailed({
          effectId: effect.effectId,
          claimToken,
          finishedAtMs,
          error: result.error,
          ...(result.resultEventId
            ? { resultEventId: result.resultEventId }
            : {}),
        });
      case "uncertain":
        return this.journal.markEffectUncertain({
          effectId: effect.effectId,
          claimToken,
          finishedAtMs,
          error: result.error,
        });
      default:
        return assertUnreachable(result);
    }
  }
}

function addDuration(timestampMs: number, durationMs: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, timestampMs + durationMs);
}

function journalErrorResult(
  effect: WorkflowEffectRecord,
  phase: "start" | "finish",
  error: unknown
): WorkflowEffectExecutionResult {
  return {
    effectId: effect.effectId,
    effectType: effect.effectType,
    outcome: "journal_error",
    phase,
    error: serializeError(error, "WORKFLOW_EFFECT_JOURNAL_ERROR"),
  };
}

function serializeError(error: unknown, code: string): WorkflowJsonValue {
  if (error instanceof Error) {
    return {
      code,
      name: error.name,
      message: error.message,
    };
  }
  return {
    code,
    message: String(error),
  };
}

function assertUnreachable(value: never): never {
  throw new Error(`Unsupported workflow effect result: ${String(value)}`);
}
