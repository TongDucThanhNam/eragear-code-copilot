import { and, desc, eq, notInArray } from "drizzle-orm";
import {
  getSqliteOrm,
  sqliteSchema,
} from "#runtime/platform/storage/sqlite-db";
import { enqueueSqliteWrite } from "#runtime/platform/storage/sqlite-write-queue";
import type {
  SupervisorRunListInput,
  SupervisorRunRepositoryPort,
} from "../application/ports/supervisor-run-repository.port";
import {
  SUPERVISOR_RUN_SCHEMA_VERSION,
  type SupervisorRunState,
  SupervisorRunStateSchema,
} from "../domain/supervisor-run.schemas";
import { SupervisorRunRevisionConflictError } from "../domain/supervisor-run.transitions";

const TERMINAL_RUN_STATUSES = ["completed", "failed", "cancelled"];
const SQLITE_OP = {
  CREATE: "supervisor_orchestration.create_run",
  SAVE: "supervisor_orchestration.save_run",
} as const;

type SqliteOrm = Awaited<ReturnType<typeof getSqliteOrm>>;
type SupervisorRunRow = typeof sqliteSchema.supervisorRuns.$inferSelect;

interface SupervisorRunSqliteRepositoryDeps {
  ormProvider?: () => Promise<SqliteOrm>;
}

export class SupervisorRunSqliteRepository
  implements SupervisorRunRepositoryPort
{
  private readonly ormProvider: () => Promise<SqliteOrm>;

  constructor(deps: SupervisorRunSqliteRepositoryDeps = {}) {
    this.ormProvider = deps.ormProvider ?? getSqliteOrm;
  }

  create(run: SupervisorRunState): Promise<SupervisorRunState> {
    const parsed = SupervisorRunStateSchema.parse(run);
    if (parsed.revision !== 0) {
      throw new SupervisorRunRevisionConflictError(
        parsed.runId,
        0,
        parsed.revision
      );
    }
    return enqueueSqliteWrite(SQLITE_OP.CREATE, async () => {
      const orm = await this.ormProvider();
      const existing = orm
        .select({ revision: sqliteSchema.supervisorRuns.revision })
        .from(sqliteSchema.supervisorRuns)
        .where(eq(sqliteSchema.supervisorRuns.runId, parsed.runId))
        .get();
      if (existing) {
        throw new SupervisorRunRevisionConflictError(
          parsed.runId,
          -1,
          existing.revision
        );
      }
      orm.insert(sqliteSchema.supervisorRuns).values(toRow(parsed)).run();
      return structuredClone(parsed);
    });
  }

  async get(runId: string, userId: string): Promise<SupervisorRunState | null> {
    const orm = await this.ormProvider();
    const row = orm
      .select()
      .from(sqliteSchema.supervisorRuns)
      .where(
        and(
          eq(sqliteSchema.supervisorRuns.runId, runId),
          eq(sqliteSchema.supervisorRuns.userId, userId)
        )
      )
      .get();
    return row ? fromRow(row) : null;
  }

  async list(input: SupervisorRunListInput): Promise<SupervisorRunState[]> {
    const orm = await this.ormProvider();
    const conditions = [eq(sqliteSchema.supervisorRuns.userId, input.userId)];
    if (input.projectId) {
      conditions.push(
        eq(sqliteSchema.supervisorRuns.projectId, input.projectId)
      );
    }
    if (input.projectRoot) {
      conditions.push(
        eq(sqliteSchema.supervisorRuns.projectRoot, input.projectRoot)
      );
    }
    if (!input.includeTerminal) {
      conditions.push(
        notInArray(sqliteSchema.supervisorRuns.status, TERMINAL_RUN_STATUSES)
      );
    }
    return orm
      .select()
      .from(sqliteSchema.supervisorRuns)
      .where(and(...conditions))
      .orderBy(desc(sqliteSchema.supervisorRuns.updatedAt))
      .all()
      .map(fromRow);
  }

  async listNonTerminal(): Promise<SupervisorRunState[]> {
    const orm = await this.ormProvider();
    return orm
      .select()
      .from(sqliteSchema.supervisorRuns)
      .where(
        notInArray(sqliteSchema.supervisorRuns.status, TERMINAL_RUN_STATUSES)
      )
      .orderBy(desc(sqliteSchema.supervisorRuns.updatedAt))
      .all()
      .map(fromRow);
  }

  save(
    run: SupervisorRunState,
    expectedRevision: number
  ): Promise<SupervisorRunState> {
    const parsed = SupervisorRunStateSchema.parse(run);
    if (parsed.revision !== expectedRevision + 1) {
      throw new SupervisorRunRevisionConflictError(
        parsed.runId,
        expectedRevision + 1,
        parsed.revision
      );
    }
    return enqueueSqliteWrite(SQLITE_OP.SAVE, async () => {
      const orm = await this.ormProvider();
      const result = orm
        .update(sqliteSchema.supervisorRuns)
        .set(toMutableRow(parsed))
        .where(
          and(
            eq(sqliteSchema.supervisorRuns.runId, parsed.runId),
            eq(sqliteSchema.supervisorRuns.userId, parsed.userId),
            eq(sqliteSchema.supervisorRuns.revision, expectedRevision)
          )
        )
        .returning({ revision: sqliteSchema.supervisorRuns.revision })
        .all();
      if (result.length !== 1) {
        const existing = orm
          .select({ revision: sqliteSchema.supervisorRuns.revision })
          .from(sqliteSchema.supervisorRuns)
          .where(eq(sqliteSchema.supervisorRuns.runId, parsed.runId))
          .get();
        throw new SupervisorRunRevisionConflictError(
          parsed.runId,
          expectedRevision,
          existing?.revision ?? -1
        );
      }
      return structuredClone(parsed);
    });
  }
}

export function migrateSupervisorRunDocument(
  value: unknown
): SupervisorRunState {
  let candidate = value;
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "schemaVersion" in candidate &&
    candidate.schemaVersion === 0
  ) {
    const legacy = candidate as Record<string, unknown>;
    candidate = {
      ...legacy,
      schemaVersion: 1,
      gates: legacy.gates ?? [],
      processedEventIds: legacy.processedEventIds ?? [],
      plannerReplanCount: legacy.plannerReplanCount ?? 0,
      finalVerification: legacy.finalVerification ?? [],
      baseSnapshot: {
        ...(legacy.baseSnapshot as Record<string, unknown>),
        targetFingerprints:
          (legacy.baseSnapshot as Record<string, unknown>)
            ?.targetFingerprints ?? {},
      },
    };
  }
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "schemaVersion" in candidate &&
    candidate.schemaVersion === 1
  ) {
    return migrateV1SupervisorRun(candidate as Record<string, unknown>);
  }
  return SupervisorRunStateSchema.parse(candidate);
}

function migrateV1SupervisorRun(
  legacy: Record<string, unknown>
): SupervisorRunState {
  const updatedAt =
    typeof legacy.updatedAt === "string"
      ? legacy.updatedAt
      : new Date(0).toISOString();
  const legacyTasks = Array.isArray(legacy.tasks) ? legacy.tasks : [];
  const tasks = legacyTasks.map((rawTask) => {
    const task = rawTask as Record<string, unknown>;
    const attempts = Array.isArray(task.attempts) ? task.attempts : [];
    return {
      ...task,
      status:
        task.status === "completed" ||
        task.status === "failed" ||
        task.status === "cancelled"
          ? task.status
          : "needs_user",
      attempts: attempts.map((rawAttempt) => {
        const attempt = rawAttempt as Record<string, unknown>;
        return attempt.status === "starting" || attempt.status === "running"
          ? { ...attempt, status: "interrupted", finishedAt: updatedAt }
          : attempt;
      }),
    };
  });
  const terminal =
    legacy.status === "completed" ||
    legacy.status === "failed" ||
    legacy.status === "cancelled";
  const limits = (legacy.limits ?? {}) as Record<string, unknown>;
  const automation = {
    ...(typeof legacy.scheduleId === "string"
      ? { scheduleId: legacy.scheduleId }
      : {}),
    ...(typeof legacy.providerId === "string"
      ? { providerId: legacy.providerId }
      : {}),
    ...(typeof legacy.workerModelId === "string"
      ? { workerModelId: legacy.workerModelId }
      : {}),
  };
  const audit = Array.isArray(legacy.audit) ? [...legacy.audit] : [];
  if (!terminal) {
    audit.push({
      auditId: `migration-v2-${String(legacy.runId ?? "unknown")}`,
      kind: "migration_needs_user",
      createdAt: updatedAt,
      actor: "system",
      summary: "Non-terminal v1 run requires ACP manager replan before resume",
    });
  }
  const migrated = {
    ...legacy,
    schemaVersion: SUPERVISOR_RUN_SCHEMA_VERSION,
    status: terminal ? legacy.status : "needs_user",
    priority: "normal",
    agentAllowlist: Array.isArray(legacy.eligibleAgentIds)
      ? legacy.eligibleAgentIds
      : undefined,
    legacyAutomation:
      Object.keys(automation).length > 0 ? automation : undefined,
    limits: {
      maxConcurrency: limits.maxConcurrency,
      maxTasks: limits.maxTasks,
      maxAttemptsPerTask: limits.maxAttemptsPerTask,
      maxPlannerReplans: limits.maxPlannerReplans,
    },
    tasks,
    capacityWaits: [],
    decisions: [],
    deliveryFingerprints: {},
    audit,
    migratedFromVersion: 1,
  } as Record<string, unknown>;
  return SupervisorRunStateSchema.parse(
    Object.fromEntries(
      Object.entries(migrated).filter(
        ([key]) =>
          key !== "scheduleId" &&
          key !== "providerId" &&
          key !== "workerModelId" &&
          key !== "eligibleAgentIds"
      )
    )
  );
}

function fromRow(row: SupervisorRunRow): SupervisorRunState {
  let value: unknown;
  try {
    value = JSON.parse(row.stateJson);
  } catch (error) {
    throw new Error(`Corrupt supervisor run JSON for ${row.runId}`, {
      cause: error,
    });
  }
  const run = migrateSupervisorRunDocument(value);
  const migratedLegacyRow =
    (row.schemaVersion === 0 || row.schemaVersion === 1) &&
    run.migratedFromVersion === 1;
  if (
    run.runId !== row.runId ||
    run.userId !== row.userId ||
    run.revision !== row.revision ||
    (!migratedLegacyRow && run.status !== row.status) ||
    (row.schemaVersion !== 0 &&
      run.schemaVersion !== row.schemaVersion &&
      !migratedLegacyRow)
  ) {
    throw new Error(`Supervisor run row integrity mismatch for ${row.runId}`);
  }
  return run;
}

function toRow(run: SupervisorRunState) {
  return {
    runId: run.runId,
    userId: run.userId,
    projectId: run.projectId ?? null,
    projectRoot: run.projectRoot,
    status: run.status,
    revision: run.revision,
    schemaVersion: run.schemaVersion,
    stateJson: JSON.stringify(run),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function toMutableRow(run: SupervisorRunState) {
  const row = toRow(run);
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
