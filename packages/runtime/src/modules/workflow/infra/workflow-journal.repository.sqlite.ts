import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  getSqliteOrm,
  sqliteSchema,
  withSqliteTransaction,
} from "#runtime/platform/storage/sqlite-db";
import { enqueueSqliteWrite } from "#runtime/platform/storage/sqlite-write-queue";
import { assertSupervisorCompatibilityStatuses } from "../../supervisor-orchestration/domain/supervisor-run.projections";
import {
  type SupervisorRunState,
  SupervisorRunStateSchema,
} from "../../supervisor-orchestration/domain/supervisor-run.schemas";
import {
  type CancelPendingWorkflowEffectsInput,
  CancelPendingWorkflowEffectsInputSchema,
  type CommitSupervisorRunTransitionInput,
  CommitSupervisorRunTransitionInputSchema,
  type CommitSupervisorRunTransitionResult,
  type CommitWorkflowEffectResultInput,
  CommitWorkflowEffectResultInputSchema,
  type CommitWorkflowEffectResultResult,
  type WorkflowEffectTerminalization,
} from "../application/contracts/supervisor-workflow-unit-of-work.contract";
import {
  type AppendWorkflowJournalInput,
  AppendWorkflowJournalInputSchema,
  type AppendWorkflowJournalResult,
  type ClaimDueWorkflowEffectsInput,
  ClaimDueWorkflowEffectsInputSchema,
  computeWorkflowPayloadHash,
  type MarkStaleWorkflowDispatchesUncertainInput,
  MarkStaleWorkflowDispatchesUncertainInputSchema,
  type MarkWorkflowEffectFailedInput,
  MarkWorkflowEffectFailedInputSchema,
  type MarkWorkflowEffectStartedInput,
  MarkWorkflowEffectStartedInputSchema,
  type MarkWorkflowEffectSucceededInput,
  MarkWorkflowEffectSucceededInputSchema,
  type MarkWorkflowEffectUncertainInput,
  MarkWorkflowEffectUncertainInputSchema,
  type ReleasePendingWorkflowEffectClaimsInput,
  ReleasePendingWorkflowEffectClaimsInputSchema,
  stringifyWorkflowJson,
  type WorkflowEffectIntentInput,
  type WorkflowEffectRecord,
  WorkflowEffectRecordSchema,
  type WorkflowEventRecord,
  WorkflowEventRecordSchema,
  type WorkflowJsonValue,
} from "../application/contracts/workflow-journal.contract";
import type { SupervisorWorkflowUnitOfWorkPort } from "../application/ports/supervisor-workflow-unit-of-work.port";
import type { WorkflowJournalPort } from "../application/ports/workflow-journal.port";

const SQLITE_OP = {
  APPEND: "workflow.journal.append",
  CLAIM_DUE: "workflow.effects.claim_due",
  MARK_STARTED: "workflow.effects.mark_started",
  MARK_SUCCEEDED: "workflow.effects.mark_succeeded",
  MARK_FAILED: "workflow.effects.mark_failed",
  MARK_UNCERTAIN: "workflow.effects.mark_uncertain",
  RECOVER_STALE: "workflow.effects.recover_stale",
  RELEASE_PENDING_CLAIMS: "workflow.effects.release_pending_claims",
  COMMIT_RUN_TRANSITION: "workflow.unit_of_work.commit_run_transition",
  COMMIT_EFFECT_RESULT: "workflow.unit_of_work.commit_effect_result",
  CANCEL_PENDING: "workflow.effects.cancel_pending",
} as const;

type SqliteOrm = Awaited<ReturnType<typeof getSqliteOrm>>;
type WorkflowEventRow = typeof sqliteSchema.workflowEvents.$inferSelect;
type WorkflowEffectRow = typeof sqliteSchema.workflowEffectIntents.$inferSelect;
type SupervisorRunRow = typeof sqliteSchema.supervisorRuns.$inferSelect;
type ParsedRunTransition = ReturnType<
  typeof CommitSupervisorRunTransitionInputSchema.parse
>;

interface WorkflowJournalSqliteAdapterDeps {
  ormProvider?: () => Promise<SqliteOrm>;
  transactionRunner?: typeof withSqliteTransaction;
}

export class WorkflowJournalConflictError extends Error {
  readonly code = "WORKFLOW_JOURNAL_CONFLICT";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkflowJournalConflictError";
  }
}

export class WorkflowJournalSqliteAdapter
  implements WorkflowJournalPort, SupervisorWorkflowUnitOfWorkPort
{
  private readonly ormProvider: () => Promise<SqliteOrm>;
  private readonly transactionRunner: typeof withSqliteTransaction;

  constructor(deps: WorkflowJournalSqliteAdapterDeps = {}) {
    this.ormProvider = deps.ormProvider ?? getSqliteOrm;
    this.transactionRunner = deps.transactionRunner ?? withSqliteTransaction;
  }

  async append(
    input: AppendWorkflowJournalInput
  ): Promise<AppendWorkflowJournalResult> {
    const parsed = AppendWorkflowJournalInputSchema.parse(input);
    validateEffectPayloadHashes(parsed.effects);
    return await enqueueSqliteWrite(
      SQLITE_OP.APPEND,
      async () =>
        await this.transactionRunner(({ orm }) => {
          const effectRows = parsed.effects.map((effect) =>
            toPendingEffectRow(parsed.event.runId, parsed.event.eventId, effect)
          );
          const existingEvents = orm
            .select()
            .from(sqliteSchema.workflowEvents)
            .where(
              or(
                eq(sqliteSchema.workflowEvents.eventId, parsed.event.eventId),
                and(
                  eq(sqliteSchema.workflowEvents.runId, parsed.event.runId),
                  eq(
                    sqliteSchema.workflowEvents.revision,
                    parsed.event.revision
                  )
                )
              )
            )
            .all();
          if (existingEvents.length > 0) {
            return resolveIdempotentAppend(
              orm,
              parsed.event,
              effectRows,
              existingEvents
            );
          }

          assertNextWorkflowEventRevision(orm, parsed.event);

          orm
            .insert(sqliteSchema.workflowEvents)
            .values(toEventRow(parsed.event))
            .run();

          if (effectRows.length > 0) {
            orm
              .insert(sqliteSchema.workflowEffectIntents)
              .values(effectRows)
              .run();
          }

          return {
            event: structuredClone(parsed.event),
            effects: effectRows.map(toEffectRecord),
          };
        })
    );
  }

  commitRunTransition(
    input: CommitSupervisorRunTransitionInput
  ): Promise<CommitSupervisorRunTransitionResult> {
    const parsed = CommitSupervisorRunTransitionInputSchema.parse(input);
    assertSupervisorCompatibilityStatuses(parsed.snapshot);
    validateEffectPayloadHashes(parsed.effects);
    return enqueueSqliteWrite(
      SQLITE_OP.COMMIT_RUN_TRANSITION,
      async () =>
        await preserveWorkflowJournalConflict(
          this.transactionRunner(({ orm }) =>
            commitRunTransitionInTransaction(orm, parsed)
          )
        )
    );
  }

  commitEffectResult(
    input: CommitWorkflowEffectResultInput
  ): Promise<CommitWorkflowEffectResultResult> {
    const parsed = CommitWorkflowEffectResultInputSchema.parse(input);
    assertSupervisorCompatibilityStatuses(parsed.transition.snapshot);
    validateEffectPayloadHashes(parsed.transition.effects);
    return enqueueSqliteWrite(
      SQLITE_OP.COMMIT_EFFECT_RESULT,
      async () =>
        await preserveWorkflowJournalConflict(
          this.transactionRunner(({ orm }) =>
            commitRunTransitionInTransaction(
              orm,
              parsed.transition,
              parsed.terminalEffect
            )
          )
        )
    );
  }

  cancelPendingEffects(
    input: CancelPendingWorkflowEffectsInput
  ): Promise<WorkflowEffectRecord[]> {
    const parsed = CancelPendingWorkflowEffectsInputSchema.parse(input);
    return enqueueSqliteWrite(
      SQLITE_OP.CANCEL_PENDING,
      async () =>
        await this.transactionRunner(({ orm }) =>
          orm
            .update(sqliteSchema.workflowEffectIntents)
            .set({
              status: "cancelled",
              finishedAtMs: parsed.cancelledAtMs,
              updatedAtMs: parsed.cancelledAtMs,
              lastErrorJson:
                parsed.reason === undefined
                  ? null
                  : stringifyWorkflowJson(parsed.reason),
            })
            .where(
              and(
                eq(sqliteSchema.workflowEffectIntents.runId, parsed.runId),
                eq(
                  sqliteSchema.workflowEffectIntents.authorityId,
                  parsed.authorityId
                ),
                eq(sqliteSchema.workflowEffectIntents.status, "pending")
              )
            )
            .returning()
            .all()
            .map(toEffectRecord)
        )
    );
  }

  async getEvent(eventId: string): Promise<WorkflowEventRecord | null> {
    const orm = await this.ormProvider();
    const row = orm
      .select()
      .from(sqliteSchema.workflowEvents)
      .where(eq(sqliteSchema.workflowEvents.eventId, eventId))
      .get();
    return row ? toEventRecord(row) : null;
  }

  async listEvents(runId: string): Promise<WorkflowEventRecord[]> {
    const orm = await this.ormProvider();
    return orm
      .select()
      .from(sqliteSchema.workflowEvents)
      .where(eq(sqliteSchema.workflowEvents.runId, runId))
      .orderBy(
        asc(sqliteSchema.workflowEvents.revision),
        asc(sqliteSchema.workflowEvents.eventId)
      )
      .all()
      .map(toEventRecord);
  }

  async getEffect(effectId: string): Promise<WorkflowEffectRecord | null> {
    const orm = await this.ormProvider();
    const row = orm
      .select()
      .from(sqliteSchema.workflowEffectIntents)
      .where(eq(sqliteSchema.workflowEffectIntents.effectId, effectId))
      .get();
    return row ? toEffectRecord(row) : null;
  }

  async listEffects(runId: string): Promise<WorkflowEffectRecord[]> {
    const orm = await this.ormProvider();
    return orm
      .select()
      .from(sqliteSchema.workflowEffectIntents)
      .where(eq(sqliteSchema.workflowEffectIntents.runId, runId))
      .orderBy(
        asc(sqliteSchema.workflowEffectIntents.createdAtMs),
        asc(sqliteSchema.workflowEffectIntents.effectId)
      )
      .all()
      .map(toEffectRecord);
  }

  claimDueEffects(
    input: ClaimDueWorkflowEffectsInput
  ): Promise<WorkflowEffectRecord[]> {
    const parsed = ClaimDueWorkflowEffectsInputSchema.parse(input);
    const leaseExpiresAtMs = Math.min(
      Number.MAX_SAFE_INTEGER,
      parsed.nowMs + parsed.leaseDurationMs
    );
    return enqueueSqliteWrite(
      SQLITE_OP.CLAIM_DUE,
      async () =>
        await this.transactionRunner(({ orm }) => {
          const candidateIds = orm
            .select({ effectId: sqliteSchema.workflowEffectIntents.effectId })
            .from(sqliteSchema.workflowEffectIntents)
            .where(claimableEffectConditions(parsed.nowMs))
            .orderBy(
              asc(sqliteSchema.workflowEffectIntents.notBeforeMs),
              asc(sqliteSchema.workflowEffectIntents.createdAtMs),
              asc(sqliteSchema.workflowEffectIntents.effectId)
            )
            .limit(parsed.limit)
            .all();
          const claimed: WorkflowEffectRecord[] = [];

          for (const candidate of candidateIds) {
            const rows = orm
              .update(sqliteSchema.workflowEffectIntents)
              .set({
                claimToken: parsed.claimToken,
                claimedAtMs: parsed.nowMs,
                leaseExpiresAtMs,
                updatedAtMs: parsed.nowMs,
              })
              .where(
                and(
                  eq(
                    sqliteSchema.workflowEffectIntents.effectId,
                    candidate.effectId
                  ),
                  claimableEffectConditions(parsed.nowMs)
                )
              )
              .returning()
              .all();
            const row = rows[0];
            if (row) {
              claimed.push(toEffectRecord(row));
            }
          }
          return claimed;
        })
    );
  }

  markEffectStarted(
    input: MarkWorkflowEffectStartedInput
  ): Promise<WorkflowEffectRecord | null> {
    const parsed = MarkWorkflowEffectStartedInputSchema.parse(input);
    return enqueueSqliteWrite(
      SQLITE_OP.MARK_STARTED,
      async () =>
        await this.transactionRunner(({ orm }) => {
          const rows = orm
            .update(sqliteSchema.workflowEffectIntents)
            .set({
              status: "started",
              attemptCount: sql`${sqliteSchema.workflowEffectIntents.attemptCount} + 1`,
              startedAtMs: parsed.startedAtMs,
              leaseExpiresAtMs: parsed.leaseExpiresAtMs,
              updatedAtMs: parsed.startedAtMs,
              finishedAtMs: null,
              lastErrorJson: null,
            })
            .where(
              and(
                eq(
                  sqliteSchema.workflowEffectIntents.effectId,
                  parsed.effectId
                ),
                eq(sqliteSchema.workflowEffectIntents.status, "pending"),
                eq(
                  sqliteSchema.workflowEffectIntents.claimToken,
                  parsed.claimToken
                ),
                gte(
                  sqliteSchema.workflowEffectIntents.leaseExpiresAtMs,
                  parsed.startedAtMs
                )
              )
            )
            .returning()
            .all();
          return rows[0] ? toEffectRecord(rows[0]) : null;
        })
    );
  }

  markEffectSucceeded(
    input: MarkWorkflowEffectSucceededInput
  ): Promise<WorkflowEffectRecord | null> {
    const parsed = MarkWorkflowEffectSucceededInputSchema.parse(input);
    return enqueueSqliteWrite(
      SQLITE_OP.MARK_SUCCEEDED,
      async () =>
        await this.transactionRunner(({ orm }) => {
          assertResultEventReference(
            orm,
            parsed.effectId,
            parsed.resultEventId
          );
          const rows = orm
            .update(sqliteSchema.workflowEffectIntents)
            .set({
              status: "succeeded",
              finishedAtMs: parsed.finishedAtMs,
              updatedAtMs: parsed.finishedAtMs,
              lastErrorJson: null,
              resultEventId: parsed.resultEventId ?? null,
            })
            .where(effectOutcomeConditions(parsed.effectId, parsed.claimToken))
            .returning()
            .all();
          return rows[0] ? toEffectRecord(rows[0]) : null;
        })
    );
  }

  markEffectFailed(
    input: MarkWorkflowEffectFailedInput
  ): Promise<WorkflowEffectRecord | null> {
    const parsed = MarkWorkflowEffectFailedInputSchema.parse(input);
    return enqueueSqliteWrite(
      SQLITE_OP.MARK_FAILED,
      async () =>
        await this.transactionRunner(({ orm }) => {
          assertResultEventReference(
            orm,
            parsed.effectId,
            parsed.resultEventId
          );
          const rows = orm
            .update(sqliteSchema.workflowEffectIntents)
            .set({
              status: "failed",
              finishedAtMs: parsed.finishedAtMs,
              updatedAtMs: parsed.finishedAtMs,
              lastErrorJson: stringifyWorkflowJson(parsed.error),
              resultEventId: parsed.resultEventId ?? null,
            })
            .where(effectOutcomeConditions(parsed.effectId, parsed.claimToken))
            .returning()
            .all();
          return rows[0] ? toEffectRecord(rows[0]) : null;
        })
    );
  }

  markEffectUncertain(
    input: MarkWorkflowEffectUncertainInput
  ): Promise<WorkflowEffectRecord | null> {
    const parsed = MarkWorkflowEffectUncertainInputSchema.parse(input);
    return enqueueSqliteWrite(
      SQLITE_OP.MARK_UNCERTAIN,
      async () =>
        await this.transactionRunner(({ orm }) => {
          const rows = orm
            .update(sqliteSchema.workflowEffectIntents)
            .set({
              status: "uncertain",
              finishedAtMs: parsed.finishedAtMs,
              updatedAtMs: parsed.finishedAtMs,
              lastErrorJson: stringifyWorkflowJson(parsed.error),
            })
            .where(
              and(
                eq(
                  sqliteSchema.workflowEffectIntents.effectId,
                  parsed.effectId
                ),
                eq(sqliteSchema.workflowEffectIntents.status, "started"),
                eq(
                  sqliteSchema.workflowEffectIntents.claimToken,
                  parsed.claimToken
                )
              )
            )
            .returning()
            .all();
          return rows[0] ? toEffectRecord(rows[0]) : null;
        })
    );
  }

  markStaleStartedDispatchesUncertain(
    input: MarkStaleWorkflowDispatchesUncertainInput
  ): Promise<WorkflowEffectRecord[]> {
    const parsed = MarkStaleWorkflowDispatchesUncertainInputSchema.parse(input);
    return enqueueSqliteWrite(
      SQLITE_OP.RECOVER_STALE,
      async () =>
        await this.transactionRunner(({ orm }) =>
          orm
            .update(sqliteSchema.workflowEffectIntents)
            .set({
              status: "uncertain",
              finishedAtMs: parsed.nowMs,
              updatedAtMs: parsed.nowMs,
              lastErrorJson: stringifyWorkflowJson(parsed.error),
            })
            .where(
              and(
                eq(sqliteSchema.workflowEffectIntents.status, "started"),
                inArray(
                  sqliteSchema.workflowEffectIntents.effectType,
                  parsed.effectTypes
                ),
                parsed.includeUnexpired
                  ? undefined
                  : or(
                      isNull(
                        sqliteSchema.workflowEffectIntents.leaseExpiresAtMs
                      ),
                      lte(
                        sqliteSchema.workflowEffectIntents.leaseExpiresAtMs,
                        parsed.nowMs
                      )
                    )
              )
            )
            .returning()
            .all()
            .map(toEffectRecord)
        )
    );
  }

  releasePendingEffectClaims(
    input: ReleasePendingWorkflowEffectClaimsInput
  ): Promise<WorkflowEffectRecord[]> {
    const parsed = ReleasePendingWorkflowEffectClaimsInputSchema.parse(input);
    return enqueueSqliteWrite(
      SQLITE_OP.RELEASE_PENDING_CLAIMS,
      async () =>
        await this.transactionRunner(({ orm }) =>
          orm
            .update(sqliteSchema.workflowEffectIntents)
            .set({
              claimToken: null,
              claimedAtMs: null,
              leaseExpiresAtMs: null,
              updatedAtMs: parsed.nowMs,
            })
            .where(
              and(
                eq(sqliteSchema.workflowEffectIntents.status, "pending"),
                isNotNull(sqliteSchema.workflowEffectIntents.claimToken)
              )
            )
            .returning()
            .all()
            .map(toEffectRecord)
        )
    );
  }
}

function commitRunTransitionInTransaction(
  orm: SqliteOrm,
  transition: ParsedRunTransition
): CommitSupervisorRunTransitionResult;
function commitRunTransitionInTransaction(
  orm: SqliteOrm,
  transition: ParsedRunTransition,
  terminalEffect: WorkflowEffectTerminalization
): CommitWorkflowEffectResultResult;
function commitRunTransitionInTransaction(
  orm: SqliteOrm,
  transition: ParsedRunTransition,
  terminalEffect?: WorkflowEffectTerminalization
): CommitSupervisorRunTransitionResult | CommitWorkflowEffectResultResult {
  const snapshot = SupervisorRunStateSchema.parse(transition.snapshot);
  const effectRows = transition.effects.map((effect) =>
    toPendingEffectRow(snapshot.runId, transition.event.eventId, effect)
  );
  const snapshotRow = orm
    .select()
    .from(sqliteSchema.supervisorRuns)
    .where(eq(sqliteSchema.supervisorRuns.runId, snapshot.runId))
    .get();
  const existingEvents = findWorkflowEventCollisions(orm, transition.event);

  if (snapshotRow?.revision === snapshot.revision) {
    if (!supervisorSnapshotMatches(snapshotRow, snapshot)) {
      throw new WorkflowJournalConflictError(
        `Supervisor snapshot collision for ${snapshot.runId}:${snapshot.revision}`
      );
    }
    const journal = resolveIdempotentAppend(
      orm,
      transition.event,
      effectRows,
      existingEvents
    );
    const result = transitionResult(
      snapshot,
      transition.expectedRevision,
      journal
    );
    return terminalEffect
      ? {
          ...result,
          effect: resolveIdempotentEffectTerminalization(
            orm,
            snapshot.runId,
            transition.event.eventId,
            terminalEffect
          ),
        }
      : result;
  }

  if (transition.expectedRevision === null) {
    if (snapshotRow) {
      throw new WorkflowJournalConflictError(
        `Supervisor run ${snapshot.runId} already exists at revision ${snapshotRow.revision}`
      );
    }
  } else if (
    !snapshotRow ||
    snapshotRow.userId !== snapshot.userId ||
    snapshotRow.revision !== transition.expectedRevision
  ) {
    throw new WorkflowJournalConflictError(
      `Supervisor run ${snapshot.runId} revision conflict: expected ${transition.expectedRevision}, actual ${snapshotRow?.revision ?? -1}`
    );
  }

  if (existingEvents.length > 0) {
    throw new WorkflowJournalConflictError(
      `Workflow event collision for ${transition.event.eventId} at ${transition.event.runId}:${transition.event.revision}`
    );
  }
  assertWorkflowEventHead(orm, snapshot.runId, transition.expectedRevision);
  const sourceEffect = terminalEffect
    ? requireTerminalizableEffect(orm, snapshot.runId, terminalEffect)
    : undefined;

  if (transition.expectedRevision === null) {
    orm
      .insert(sqliteSchema.supervisorRuns)
      .values(toSupervisorRunRow(snapshot))
      .run();
  } else {
    const rows = orm
      .update(sqliteSchema.supervisorRuns)
      .set(toMutableSupervisorRunRow(snapshot))
      .where(
        and(
          eq(sqliteSchema.supervisorRuns.runId, snapshot.runId),
          eq(sqliteSchema.supervisorRuns.userId, snapshot.userId),
          eq(sqliteSchema.supervisorRuns.revision, transition.expectedRevision)
        )
      )
      .returning({ revision: sqliteSchema.supervisorRuns.revision })
      .all();
    if (rows.length !== 1) {
      throw new WorkflowJournalConflictError(
        `Supervisor run ${snapshot.runId} changed during workflow commit`
      );
    }
  }

  appendNewWorkflowRecords(orm, transition.event, effectRows);
  const journal = {
    event: structuredClone(transition.event),
    effects: effectRows.map(toEffectRecord),
  };
  const result = transitionResult(
    snapshot,
    transition.expectedRevision,
    journal
  );
  if (!(terminalEffect && sourceEffect)) {
    return result;
  }
  const terminalized = terminalizeEffect(
    orm,
    sourceEffect,
    transition.event.eventId,
    terminalEffect
  );
  return { ...result, effect: terminalized };
}

function transitionResult(
  snapshot: SupervisorRunState,
  expectedRevision: number | null,
  journal: AppendWorkflowJournalResult
): CommitSupervisorRunTransitionResult {
  return {
    snapshot: structuredClone(snapshot),
    created: expectedRevision === null,
    previousRevision: expectedRevision,
    committedRevision: snapshot.revision,
    event: journal.event,
    effects: journal.effects,
  };
}

function findWorkflowEventCollisions(
  orm: SqliteOrm,
  event: WorkflowEventRecord
): WorkflowEventRow[] {
  return orm
    .select()
    .from(sqliteSchema.workflowEvents)
    .where(
      or(
        eq(sqliteSchema.workflowEvents.eventId, event.eventId),
        and(
          eq(sqliteSchema.workflowEvents.runId, event.runId),
          eq(sqliteSchema.workflowEvents.revision, event.revision)
        )
      )
    )
    .all();
}

function assertWorkflowEventHead(
  orm: SqliteOrm,
  runId: string,
  expectedRevision: number | null
): void {
  const head = orm
    .select({ revision: sqliteSchema.workflowEvents.revision })
    .from(sqliteSchema.workflowEvents)
    .where(eq(sqliteSchema.workflowEvents.runId, runId))
    .orderBy(desc(sqliteSchema.workflowEvents.revision))
    .limit(1)
    .get();
  const actualRevision = head?.revision ?? null;
  if (actualRevision !== expectedRevision) {
    throw new WorkflowJournalConflictError(
      `Workflow event head conflict for ${runId}: expected ${expectedRevision ?? "empty"}, actual ${actualRevision ?? "empty"}`
    );
  }
}

function assertNextWorkflowEventRevision(
  orm: SqliteOrm,
  event: WorkflowEventRecord
): void {
  const head = orm
    .select({ revision: sqliteSchema.workflowEvents.revision })
    .from(sqliteSchema.workflowEvents)
    .where(eq(sqliteSchema.workflowEvents.runId, event.runId))
    .orderBy(desc(sqliteSchema.workflowEvents.revision))
    .limit(1)
    .get();
  const expectedRevision = head ? head.revision + 1 : 0;
  if (event.revision !== expectedRevision) {
    throw new WorkflowJournalConflictError(
      `Workflow event revision gap for ${event.runId}: expected ${expectedRevision}, received ${event.revision}`
    );
  }
}

function appendNewWorkflowRecords(
  orm: SqliteOrm,
  event: WorkflowEventRecord,
  effectRows: WorkflowEffectRow[]
): void {
  orm.insert(sqliteSchema.workflowEvents).values(toEventRow(event)).run();
  if (effectRows.length > 0) {
    orm.insert(sqliteSchema.workflowEffectIntents).values(effectRows).run();
  }
}

function requireTerminalizableEffect(
  orm: SqliteOrm,
  runId: string,
  terminal: WorkflowEffectTerminalization
): WorkflowEffectRow {
  const effect = orm
    .select()
    .from(sqliteSchema.workflowEffectIntents)
    .where(eq(sqliteSchema.workflowEffectIntents.effectId, terminal.effectId))
    .get();
  if (
    !effect ||
    effect.runId !== runId ||
    effect.claimToken !== terminal.claimToken ||
    (effect.status !== "started" && effect.status !== "uncertain") ||
    (effect.status === "uncertain" && terminal.status === "uncertain")
  ) {
    throw new WorkflowJournalConflictError(
      `Workflow effect ${terminal.effectId} is not terminalizable for run ${runId}`
    );
  }
  return effect;
}

function terminalizeEffect(
  orm: SqliteOrm,
  source: WorkflowEffectRow,
  resultEventId: string,
  terminal: WorkflowEffectTerminalization
): WorkflowEffectRecord {
  const rows = orm
    .update(sqliteSchema.workflowEffectIntents)
    .set({
      status: terminal.status,
      finishedAtMs: terminal.finishedAtMs,
      updatedAtMs: terminal.finishedAtMs,
      lastErrorJson:
        terminal.error === undefined
          ? null
          : stringifyWorkflowJson(terminal.error),
      resultEventId,
    })
    .where(
      and(
        eq(sqliteSchema.workflowEffectIntents.effectId, source.effectId),
        eq(sqliteSchema.workflowEffectIntents.runId, source.runId),
        eq(sqliteSchema.workflowEffectIntents.claimToken, terminal.claimToken),
        inArray(sqliteSchema.workflowEffectIntents.status, [
          "started",
          "uncertain",
        ])
      )
    )
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new WorkflowJournalConflictError(
      `Workflow effect ${terminal.effectId} changed during terminalization`
    );
  }
  return toEffectRecord(row);
}

function resolveIdempotentEffectTerminalization(
  orm: SqliteOrm,
  runId: string,
  resultEventId: string,
  terminal: WorkflowEffectTerminalization
): WorkflowEffectRecord {
  const row = orm
    .select()
    .from(sqliteSchema.workflowEffectIntents)
    .where(eq(sqliteSchema.workflowEffectIntents.effectId, terminal.effectId))
    .get();
  const errorMatches =
    terminal.error === undefined
      ? row?.lastErrorJson === null
      : Boolean(
          row?.lastErrorJson &&
            storedWorkflowJsonMatches(
              row.lastErrorJson,
              terminal.error,
              terminal.effectId
            )
        );
  if (
    !row ||
    row.runId !== runId ||
    row.claimToken !== terminal.claimToken ||
    row.status !== terminal.status ||
    row.finishedAtMs !== terminal.finishedAtMs ||
    row.resultEventId !== resultEventId ||
    !errorMatches
  ) {
    throw new WorkflowJournalConflictError(
      `Workflow effect terminalization collision for ${terminal.effectId}`
    );
  }
  return toEffectRecord(row);
}

function supervisorSnapshotMatches(
  row: SupervisorRunRow,
  snapshot: SupervisorRunState
): boolean {
  const expected = toSupervisorRunRow(snapshot);
  return (
    row.runId === expected.runId &&
    row.userId === expected.userId &&
    row.projectId === expected.projectId &&
    row.projectRoot === expected.projectRoot &&
    row.status === expected.status &&
    row.revision === expected.revision &&
    row.schemaVersion === expected.schemaVersion &&
    row.stateJson === expected.stateJson &&
    row.createdAt === expected.createdAt &&
    row.updatedAt === expected.updatedAt
  );
}

function toSupervisorRunRow(snapshot: SupervisorRunState): SupervisorRunRow {
  return {
    runId: snapshot.runId,
    userId: snapshot.userId,
    projectId: snapshot.projectId ?? null,
    projectRoot: snapshot.projectRoot,
    status: snapshot.status,
    revision: snapshot.revision,
    schemaVersion: snapshot.schemaVersion,
    stateJson: JSON.stringify(snapshot),
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

function toMutableSupervisorRunRow(snapshot: SupervisorRunState) {
  const row = toSupervisorRunRow(snapshot);
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

function assertResultEventReference(
  orm: SqliteOrm,
  effectId: string,
  resultEventId: string | undefined
): void {
  if (!resultEventId) {
    return;
  }
  const effect = orm
    .select({ runId: sqliteSchema.workflowEffectIntents.runId })
    .from(sqliteSchema.workflowEffectIntents)
    .where(eq(sqliteSchema.workflowEffectIntents.effectId, effectId))
    .get();
  const event = orm
    .select({ runId: sqliteSchema.workflowEvents.runId })
    .from(sqliteSchema.workflowEvents)
    .where(eq(sqliteSchema.workflowEvents.eventId, resultEventId))
    .get();
  if (!(effect && event && effect.runId === event.runId)) {
    throw new WorkflowJournalConflictError(
      `Workflow result event ${resultEventId} does not reference effect ${effectId} in the same run`
    );
  }
}

function claimableEffectConditions(nowMs: number) {
  return and(
    eq(sqliteSchema.workflowEffectIntents.status, "pending"),
    lte(sqliteSchema.workflowEffectIntents.notBeforeMs, nowMs),
    or(
      isNull(sqliteSchema.workflowEffectIntents.leaseExpiresAtMs),
      lte(sqliteSchema.workflowEffectIntents.leaseExpiresAtMs, nowMs)
    )
  );
}

function effectOutcomeConditions(effectId: string, claimToken?: string) {
  return and(
    eq(sqliteSchema.workflowEffectIntents.effectId, effectId),
    claimToken
      ? and(
          inArray(sqliteSchema.workflowEffectIntents.status, [
            "started",
            "uncertain",
          ]),
          eq(sqliteSchema.workflowEffectIntents.claimToken, claimToken)
        )
      : eq(sqliteSchema.workflowEffectIntents.status, "uncertain")
  );
}

function resolveIdempotentAppend(
  orm: SqliteOrm,
  event: WorkflowEventRecord,
  expectedEffects: WorkflowEffectRow[],
  existingEvents: WorkflowEventRow[]
): AppendWorkflowJournalResult {
  const existingEvent = existingEvents[0];
  if (
    existingEvents.length !== 1 ||
    !existingEvent ||
    !eventIdentityAndContentMatches(existingEvent, event)
  ) {
    throw new WorkflowJournalConflictError(
      `Workflow event identity collision for ${event.eventId} at ${event.runId}:${event.revision}`
    );
  }

  const existingEffects = orm
    .select()
    .from(sqliteSchema.workflowEffectIntents)
    .where(
      eq(
        sqliteSchema.workflowEffectIntents.sourceEventId,
        existingEvent.eventId
      )
    )
    .all();
  if (existingEffects.length !== expectedEffects.length) {
    throw new WorkflowJournalConflictError(
      `Workflow effect set collision for event ${event.eventId}`
    );
  }

  const existingById = new Map(
    existingEffects.map((effect) => [effect.effectId, effect])
  );
  const orderedEffects = expectedEffects.map((expected) => {
    const existing = existingById.get(expected.effectId);
    if (!(existing && effectIdentityAndContentMatches(existing, expected))) {
      throw new WorkflowJournalConflictError(
        `Workflow effect identity collision for ${expected.effectId}`
      );
    }
    return toEffectRecord(existing);
  });
  return {
    event: toEventRecord(existingEvent),
    effects: orderedEffects,
  };
}

function eventIdentityAndContentMatches(
  row: WorkflowEventRow,
  event: WorkflowEventRecord
): boolean {
  return (
    row.eventId === event.eventId &&
    row.runId === event.runId &&
    row.revision === event.revision &&
    row.eventType === event.eventType &&
    row.payloadVersion === event.payloadVersion &&
    storedWorkflowJsonMatches(row.payloadJson, event.payload, row.eventId) &&
    row.occurredAtMs === event.occurredAtMs
  );
}

function effectIdentityAndContentMatches(
  row: WorkflowEffectRow,
  expected: WorkflowEffectRow
): boolean {
  return (
    row.effectId === expected.effectId &&
    row.runId === expected.runId &&
    row.authorityId === expected.authorityId &&
    row.sourceEventId === expected.sourceEventId &&
    row.effectType === expected.effectType &&
    row.payloadVersion === expected.payloadVersion &&
    row.payloadJson === expected.payloadJson &&
    row.payloadHash === expected.payloadHash &&
    row.promptHash === expected.promptHash &&
    row.idempotencyKey === expected.idempotencyKey &&
    row.notBeforeMs === expected.notBeforeMs &&
    row.attemptId === expected.attemptId &&
    row.sessionId === expected.sessionId &&
    row.workspaceId === expected.workspaceId &&
    row.createdAtMs === expected.createdAtMs
  );
}

function toEventRow(event: WorkflowEventRecord) {
  return {
    eventId: event.eventId,
    runId: event.runId,
    revision: event.revision,
    eventType: event.eventType,
    payloadVersion: event.payloadVersion,
    payloadJson: stringifyWorkflowJson(event.payload),
    occurredAtMs: event.occurredAtMs,
  };
}

function toPendingEffectRow(
  runId: string,
  sourceEventId: string,
  effect: WorkflowEffectIntentInput
): WorkflowEffectRow {
  return {
    effectId: effect.effectId,
    runId,
    authorityId: effect.authorityId ?? runId,
    sourceEventId,
    effectType: effect.effectType,
    payloadVersion: effect.payloadVersion,
    payloadJson: stringifyWorkflowJson(effect.payload),
    payloadHash: effect.payloadHash,
    promptHash: effect.promptHash ?? null,
    idempotencyKey: effect.idempotencyKey,
    status: "pending",
    notBeforeMs: effect.notBeforeMs,
    attemptCount: 0,
    claimToken: null,
    claimedAtMs: null,
    leaseExpiresAtMs: null,
    attemptId: effect.attemptId ?? null,
    sessionId: effect.sessionId ?? null,
    workspaceId: effect.workspaceId ?? null,
    createdAtMs: effect.createdAtMs,
    updatedAtMs: effect.createdAtMs,
    startedAtMs: null,
    finishedAtMs: null,
    lastErrorJson: null,
    resultEventId: null,
  };
}

function toEventRecord(row: WorkflowEventRow): WorkflowEventRecord {
  return WorkflowEventRecordSchema.parse({
    eventId: row.eventId,
    runId: row.runId,
    revision: row.revision,
    eventType: row.eventType,
    payloadVersion: row.payloadVersion,
    payload: parseWorkflowJson(row.payloadJson, row.eventId),
    occurredAtMs: row.occurredAtMs,
  });
}

function toEffectRecord(row: WorkflowEffectRow): WorkflowEffectRecord {
  return WorkflowEffectRecordSchema.parse({
    effectId: row.effectId,
    runId: row.runId,
    authorityId: row.authorityId,
    sourceEventId: row.sourceEventId,
    effectType: row.effectType,
    payloadVersion: row.payloadVersion,
    payload: parseWorkflowJson(row.payloadJson, row.effectId),
    payloadHash: row.payloadHash,
    ...(row.promptHash ? { promptHash: row.promptHash } : {}),
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    notBeforeMs: row.notBeforeMs,
    attemptCount: row.attemptCount,
    ...(row.claimToken ? { claimToken: row.claimToken } : {}),
    ...(row.claimedAtMs === null ? {} : { claimedAtMs: row.claimedAtMs }),
    ...(row.leaseExpiresAtMs === null
      ? {}
      : { leaseExpiresAtMs: row.leaseExpiresAtMs }),
    ...(row.attemptId ? { attemptId: row.attemptId } : {}),
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    createdAtMs: row.createdAtMs,
    updatedAtMs: row.updatedAtMs,
    ...(row.startedAtMs === null ? {} : { startedAtMs: row.startedAtMs }),
    ...(row.finishedAtMs === null ? {} : { finishedAtMs: row.finishedAtMs }),
    ...(row.lastErrorJson
      ? { lastError: parseWorkflowJson(row.lastErrorJson, row.effectId) }
      : {}),
    ...(row.resultEventId ? { resultEventId: row.resultEventId } : {}),
  });
}

function parseWorkflowJson(value: string, recordId: string): WorkflowJsonValue {
  try {
    return JSON.parse(value) as WorkflowJsonValue;
  } catch (error) {
    throw new Error(`Corrupt workflow JSON for ${recordId}`, { cause: error });
  }
}

function storedWorkflowJsonMatches(
  storedJson: string,
  expected: WorkflowJsonValue,
  recordId: string
): boolean {
  return (
    stringifyWorkflowJson(parseWorkflowJson(storedJson, recordId)) ===
    stringifyWorkflowJson(expected)
  );
}

function validateEffectPayloadHashes(
  effects: readonly WorkflowEffectIntentInput[]
): void {
  for (const effect of effects) {
    const expectedHash = computeWorkflowPayloadHash(effect.payload);
    if (effect.payloadHash !== expectedHash) {
      throw new WorkflowJournalConflictError(
        `Workflow effect payload hash mismatch for ${effect.effectId}`
      );
    }
  }
}

async function preserveWorkflowJournalConflict<T>(
  transaction: Promise<T>
): Promise<T> {
  try {
    return await transaction;
  } catch (error) {
    const conflict = findWorkflowJournalConflict(error);
    if (conflict) {
      throw conflict;
    }
    const constraint = findWorkflowJournalUniqueConstraint(error);
    if (constraint) {
      throw new WorkflowJournalConflictError(
        "Workflow journal identity or authority-scoped idempotency conflict",
        { cause: constraint }
      );
    }
    throw error;
  }
}

function findWorkflowJournalConflict(
  error: unknown
): WorkflowJournalConflictError | undefined {
  const visited = new Set<Error>();
  let current = error;
  while (current instanceof Error && !visited.has(current)) {
    if (current instanceof WorkflowJournalConflictError) {
      return current;
    }
    visited.add(current);
    current = current.cause;
  }
  return undefined;
}

function findWorkflowJournalUniqueConstraint(
  error: unknown
): Error | undefined {
  const pending: unknown[] = [error];
  const visited = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) {
      continue;
    }
    visited.add(current);
    if (!(current instanceof Error)) {
      continue;
    }
    const code = Reflect.get(current, "code");
    const isUniqueConstraint =
      code === "SQLITE_CONSTRAINT_UNIQUE" ||
      current.message.includes("UNIQUE constraint failed");
    const isWorkflowJournalTable =
      current.message.includes("workflow_effect_intents.") ||
      current.message.includes("workflow_events.");
    if (isUniqueConstraint && isWorkflowJournalTable) {
      return current;
    }
    pending.push(current.cause);
    if (current instanceof AggregateError) {
      pending.push(...current.errors);
    }
  }
  return undefined;
}
