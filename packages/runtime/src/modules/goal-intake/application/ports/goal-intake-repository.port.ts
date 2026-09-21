import type { GoalIntakeState } from "../../domain/goal-intake.schemas";

export interface GoalIntakeListInput {
  userId: string;
  projectId?: string;
  includeConverted?: boolean;
}

export interface GoalIntakeRepositoryPort {
  create(state: GoalIntakeState): Promise<GoalIntakeState>;
  get(intakeId: string, userId: string): Promise<GoalIntakeState | null>;
  list(input: GoalIntakeListInput): Promise<GoalIntakeState[]>;
  save(
    state: GoalIntakeState,
    expectedRevision: number
  ): Promise<GoalIntakeState>;
}

export class GoalIntakeRevisionConflictError extends Error {
  readonly code = "GOAL_INTAKE_REVISION_CONFLICT";
  readonly intakeId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(
    intakeId: string,
    expectedRevision: number,
    actualRevision: number
  ) {
    super(
      `Goal intake ${intakeId} revision changed: expected ${expectedRevision}, actual ${actualRevision}`
    );
    this.name = "GoalIntakeRevisionConflictError";
    this.intakeId = intakeId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}
