import { and, desc, eq, ne } from "drizzle-orm";
import {
  getSqliteOrm,
  sqliteSchema,
} from "#runtime/platform/storage/sqlite-db";
import { enqueueSqliteWrite } from "#runtime/platform/storage/sqlite-write-queue";
import {
  type GoalIntakeListInput,
  type GoalIntakeRepositoryPort,
  GoalIntakeRevisionConflictError,
} from "../application/ports/goal-intake-repository.port";
import {
  type GoalIntakeState,
  GoalIntakeStateSchema,
} from "../domain/goal-intake.schemas";

const SQLITE_OP = {
  CREATE: "goal_intake.create",
  SAVE: "goal_intake.save",
} as const;

type SqliteOrm = Awaited<ReturnType<typeof getSqliteOrm>>;
type GoalIntakeRow = typeof sqliteSchema.goalIntakes.$inferSelect;

interface GoalIntakeSqliteRepositoryDeps {
  ormProvider?: () => Promise<SqliteOrm>;
}

export class GoalIntakeSqliteRepository implements GoalIntakeRepositoryPort {
  private readonly ormProvider: () => Promise<SqliteOrm>;

  constructor(deps: GoalIntakeSqliteRepositoryDeps = {}) {
    this.ormProvider = deps.ormProvider ?? getSqliteOrm;
  }

  create(state: GoalIntakeState): Promise<GoalIntakeState> {
    const parsed = GoalIntakeStateSchema.parse(state);
    if (parsed.revision !== 0) {
      throw new GoalIntakeRevisionConflictError(
        parsed.intakeId,
        0,
        parsed.revision
      );
    }

    return enqueueSqliteWrite(SQLITE_OP.CREATE, async () => {
      const orm = await this.ormProvider();
      const inserted = orm
        .insert(sqliteSchema.goalIntakes)
        .values(toRow(parsed))
        .onConflictDoNothing({ target: sqliteSchema.goalIntakes.intakeId })
        .returning({ intakeId: sqliteSchema.goalIntakes.intakeId })
        .all();
      if (inserted.length !== 1) {
        const existing = orm
          .select({
            revision: sqliteSchema.goalIntakes.revision,
            userId: sqliteSchema.goalIntakes.userId,
          })
          .from(sqliteSchema.goalIntakes)
          .where(eq(sqliteSchema.goalIntakes.intakeId, parsed.intakeId))
          .get();
        throw new GoalIntakeRevisionConflictError(
          parsed.intakeId,
          -1,
          existing?.userId === parsed.userId ? existing.revision : -1
        );
      }
      return structuredClone(parsed);
    });
  }

  async get(intakeId: string, userId: string): Promise<GoalIntakeState | null> {
    const orm = await this.ormProvider();
    const row = orm
      .select()
      .from(sqliteSchema.goalIntakes)
      .where(
        and(
          eq(sqliteSchema.goalIntakes.intakeId, intakeId),
          eq(sqliteSchema.goalIntakes.userId, userId)
        )
      )
      .get();
    return row ? fromRow(row) : null;
  }

  async list(input: GoalIntakeListInput): Promise<GoalIntakeState[]> {
    const orm = await this.ormProvider();
    const conditions = [eq(sqliteSchema.goalIntakes.userId, input.userId)];
    if (input.projectId) {
      conditions.push(eq(sqliteSchema.goalIntakes.projectId, input.projectId));
    }
    if (!input.includeConverted) {
      conditions.push(ne(sqliteSchema.goalIntakes.status, "converted"));
    }

    return orm
      .select()
      .from(sqliteSchema.goalIntakes)
      .where(and(...conditions))
      .orderBy(desc(sqliteSchema.goalIntakes.updatedAt))
      .all()
      .map(fromRow);
  }

  save(
    state: GoalIntakeState,
    expectedRevision: number
  ): Promise<GoalIntakeState> {
    const parsed = GoalIntakeStateSchema.parse(state);
    if (parsed.revision !== expectedRevision + 1) {
      throw new GoalIntakeRevisionConflictError(
        parsed.intakeId,
        expectedRevision + 1,
        parsed.revision
      );
    }

    return enqueueSqliteWrite(SQLITE_OP.SAVE, async () => {
      const orm = await this.ormProvider();
      const updated = orm
        .update(sqliteSchema.goalIntakes)
        .set(toMutableRow(parsed))
        .where(
          and(
            eq(sqliteSchema.goalIntakes.intakeId, parsed.intakeId),
            eq(sqliteSchema.goalIntakes.userId, parsed.userId),
            eq(sqliteSchema.goalIntakes.revision, expectedRevision),
            eq(sqliteSchema.goalIntakes.createdAt, parsed.createdAt)
          )
        )
        .returning({ revision: sqliteSchema.goalIntakes.revision })
        .all();
      if (updated.length !== 1) {
        const existing = orm
          .select({ revision: sqliteSchema.goalIntakes.revision })
          .from(sqliteSchema.goalIntakes)
          .where(
            and(
              eq(sqliteSchema.goalIntakes.intakeId, parsed.intakeId),
              eq(sqliteSchema.goalIntakes.userId, parsed.userId)
            )
          )
          .get();
        throw new GoalIntakeRevisionConflictError(
          parsed.intakeId,
          expectedRevision,
          existing?.revision ?? -1
        );
      }

      return structuredClone(parsed);
    });
  }
}

function fromRow(row: GoalIntakeRow): GoalIntakeState {
  let value: unknown;
  try {
    value = JSON.parse(row.stateJson);
  } catch (error) {
    throw new Error(`Corrupt goal intake JSON for ${row.intakeId}`, {
      cause: error,
    });
  }

  const state = GoalIntakeStateSchema.parse(value);
  if (
    state.intakeId !== row.intakeId ||
    state.userId !== row.userId ||
    state.projectId !== row.projectId ||
    state.projectRoot !== row.projectRoot ||
    state.status !== row.status ||
    state.revision !== row.revision ||
    state.schemaVersion !== row.schemaVersion ||
    state.createdAt !== row.createdAt ||
    state.updatedAt !== row.updatedAt
  ) {
    throw new Error(`Goal intake row integrity mismatch for ${row.intakeId}`);
  }
  return state;
}

function toRow(state: GoalIntakeState) {
  return {
    intakeId: state.intakeId,
    userId: state.userId,
    projectId: state.projectId,
    projectRoot: state.projectRoot,
    status: state.status,
    revision: state.revision,
    schemaVersion: state.schemaVersion,
    stateJson: JSON.stringify(state),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

function toMutableRow(state: GoalIntakeState) {
  const row = toRow(state);
  return {
    projectId: row.projectId,
    projectRoot: row.projectRoot,
    status: row.status,
    revision: row.revision,
    schemaVersion: row.schemaVersion,
    stateJson: row.stateJson,
    updatedAt: row.updatedAt,
  };
}
