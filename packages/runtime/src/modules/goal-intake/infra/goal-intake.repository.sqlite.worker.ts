import { callSqliteWorker } from "#runtime/platform/storage/sqlite-worker-client";
import {
  type GoalIntakeListInput,
  type GoalIntakeRepositoryPort,
  GoalIntakeRevisionConflictError,
} from "../application/ports/goal-intake-repository.port";
import type { GoalIntakeState } from "../domain/goal-intake.schemas";

export class GoalIntakeSqliteWorkerRepository
  implements GoalIntakeRepositoryPort
{
  create(state: GoalIntakeState): Promise<GoalIntakeState> {
    return callGoalIntakeWorker("create", [state]);
  }

  get(intakeId: string, userId: string): Promise<GoalIntakeState | null> {
    return callGoalIntakeWorker("get", [intakeId, userId]);
  }

  list(input: GoalIntakeListInput): Promise<GoalIntakeState[]> {
    return callGoalIntakeWorker("list", [input]);
  }

  save(
    state: GoalIntakeState,
    expectedRevision: number
  ): Promise<GoalIntakeState> {
    return callGoalIntakeWorker("save", [state, expectedRevision]);
  }
}

async function callGoalIntakeWorker<T>(
  method: string,
  args: unknown[]
): Promise<T> {
  try {
    return await callSqliteWorker("goalIntake", method, args);
  } catch (error) {
    if (
      error instanceof Error &&
      Reflect.get(error, "code") === "GOAL_INTAKE_REVISION_CONFLICT"
    ) {
      const intakeId = Reflect.get(error, "intakeId");
      const expectedRevision = Reflect.get(error, "expectedRevision");
      const actualRevision = Reflect.get(error, "actualRevision");
      if (
        typeof intakeId === "string" &&
        typeof expectedRevision === "number" &&
        typeof actualRevision === "number"
      ) {
        throw new GoalIntakeRevisionConflictError(
          intakeId,
          expectedRevision,
          actualRevision
        );
      }
    }
    throw error;
  }
}
