import { eq } from "drizzle-orm";
import {
  getSqliteOrm,
  sqliteSchema,
} from "#runtime/platform/storage/sqlite-db";
import { enqueueSqliteWrite } from "#runtime/platform/storage/sqlite-write-queue";
import {
  type SupervisorGoalState,
  SupervisorGoalStateSchema,
} from "../application/goal-mode.schemas";
import type { GoalModeStateRepositoryPort } from "../application/ports/goal-mode-state.repository";

const GOAL_MODE_SCHEMA_VERSION = 1;

export class SqliteGoalModeStateRepository
  implements GoalModeStateRepositoryPort
{
  async get(
    goalId: string,
    userId?: string
  ): Promise<SupervisorGoalState | null> {
    const orm = await getSqliteOrm();
    const row = orm
      .select()
      .from(sqliteSchema.goalModeStates)
      .where(eq(sqliteSchema.goalModeStates.goalId, goalId))
      .get();
    if (!row) {
      return null;
    }
    if (row.schemaVersion !== GOAL_MODE_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported Goal Mode state version: ${row.schemaVersion}`
      );
    }
    const state = SupervisorGoalStateSchema.parse(JSON.parse(row.stateJson));
    return !userId || state.userId === userId ? state : null;
  }

  save(state: SupervisorGoalState): Promise<void> {
    const parsed = SupervisorGoalStateSchema.parse(state);
    return enqueueSqliteWrite("goal_mode.save_state", async () => {
      const orm = await getSqliteOrm();
      const stateJson = JSON.stringify(parsed);
      const updatedAt = new Date().toISOString();
      orm
        .insert(sqliteSchema.goalModeStates)
        .values({
          goalId: parsed.goalId,
          userId: parsed.userId,
          schemaVersion: GOAL_MODE_SCHEMA_VERSION,
          stateJson,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: sqliteSchema.goalModeStates.goalId,
          set: {
            schemaVersion: GOAL_MODE_SCHEMA_VERSION,
            userId: parsed.userId,
            stateJson,
            updatedAt,
          },
        })
        .run();
    });
  }
}
