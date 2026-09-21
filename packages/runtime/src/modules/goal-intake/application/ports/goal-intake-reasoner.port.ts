import type {
  GoalContractRevision,
  GoalIntakeReasonerResult,
  GoalIntakeState,
} from "../../domain/goal-intake.schemas";

export interface GoalIntakeReasonerSnapshot {
  intakeId: string;
  userId: string;
  projectId: string;
  projectRoot: string;
  title?: string;
  roughOutcome: string;
  depth: GoalIntakeState["depth"];
  minimumRounds: number;
  discoveryRoundCount: number;
  messages: GoalIntakeState["messages"];
  importedConsultations: Array<{
    provider: GoalIntakeState["providers"][number];
    reason: string;
    response: string;
  }>;
  activeContract?: GoalContractRevision;
}

export interface GoalIntakeReasonerPort {
  advance(input: {
    turnId: string;
    idempotencyKey: string;
    prompt: string;
    promptHash: string;
    snapshot: GoalIntakeReasonerSnapshot;
  }): Promise<unknown>;
}

export interface GoalRunPort {
  createFromContract(input: {
    sourceIntakeId: string;
    userId: string;
    projectId: string;
    projectRoot: string;
    title?: string;
    contractRevision: GoalContractRevision;
    consultationResults: Array<{
      consultationId: string;
      provider: GoalIntakeState["providers"][number];
      response: string;
    }>;
  }): Promise<{ runId: string; status: string }>;
}

export type GoalIntakeReasonerAdvanceResult = GoalIntakeReasonerResult;
