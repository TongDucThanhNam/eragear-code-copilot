import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeSqliteStorage } from "#runtime/platform/storage/sqlite-db";
import { resetStoragePathCacheForTests } from "#runtime/platform/storage/storage-path";
import { createSupervisorRunFixture } from "../../supervisor-orchestration/domain/supervisor-run.test-fixture";
import { transitionSupervisorRun } from "../../supervisor-orchestration/domain/supervisor-run.transitions";
import { SupervisorRunSqliteRepository } from "../../supervisor-orchestration/infra/supervisor-run.repository.sqlite";
import {
  computeWorkflowPayloadHash,
  KNOWN_WORKFLOW_EFFECT_TYPES,
  type WorkflowEffectIntentInput,
  type WorkflowEventInput,
  type WorkflowJsonValue,
} from "../application/contracts/workflow-journal.contract";
import { WorkflowJournalSqliteAdapter } from "./workflow-journal.repository.sqlite";

const PROMPT_HASH = "b".repeat(64);

describe("WorkflowJournalSqliteAdapter", () => {
  let previousStorageDir: string | undefined;
  let tempStorageDir = "";

  beforeEach(async () => {
    previousStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    await closeSqliteStorage();
    tempStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "eragear-workflow-journal-")
    );
    process.env.ERAGEAR_STORAGE_DIR = tempStorageDir;
    resetStoragePathCacheForTests();
  });

  afterEach(async () => {
    await closeSqliteStorage();
    resetStoragePathCacheForTests();
    if (previousStorageDir === undefined) {
      Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
    } else {
      process.env.ERAGEAR_STORAGE_DIR = previousStorageDir;
    }
    await removeTempDirWithRetry(tempStorageDir);
  });

  test("atomically appends a typed event and effect intents across restart", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const event = createEvent("run-1", 0, "run_created");
    const effects = [
      createEffect("effect-1", "start_turn", 100),
      createEffect("effect-2", "schedule_wakeup", 200),
    ];

    const appended = await repository.append({ event, effects });
    expect(appended.event).toEqual(event);
    expect(appended.effects.map((effect) => effect.status)).toEqual([
      "pending",
      "pending",
    ]);

    await closeSqliteStorage();
    const recreated = new WorkflowJournalSqliteAdapter();
    const replayed = await recreated.append({ event, effects });
    expect(replayed.event).toEqual(event);
    expect(replayed.effects.map((effect) => effect.effectId)).toEqual([
      "effect-1",
      "effect-2",
    ]);
    expect(await recreated.listEvents(event.runId)).toEqual([event]);
    expect(
      (await recreated.listEffects(event.runId)).map((effect) => ({
        effectId: effect.effectId,
        authorityId: effect.authorityId,
        payload: effect.payload,
        promptHash: effect.promptHash,
        sourceEventId: effect.sourceEventId,
      }))
    ).toEqual([
      {
        effectId: "effect-1",
        authorityId: event.runId,
        payload: { effectId: "effect-1" },
        promptHash: PROMPT_HASH,
        sourceEventId: event.eventId,
      },
      {
        effectId: "effect-2",
        authorityId: event.runId,
        payload: { effectId: "effect-2" },
        promptHash: PROMPT_HASH,
        sourceEventId: event.eventId,
      },
    ]);
  });

  test("migration establishes a journal boundary for existing supervisor snapshots", async () => {
    const database = new Database(path.join(tempStorageDir, "eragear.sqlite"), {
      create: true,
    });
    database.exec(`
      CREATE TABLE supervisor_runs (
        run_id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL,
        project_id text,
        project_root text NOT NULL,
        status text NOT NULL,
        revision integer NOT NULL,
        schema_version integer NOT NULL,
        state_json text NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `);
    const insert = database.prepare(`
      INSERT INTO supervisor_runs (
        run_id, user_id, project_id, project_root, status, revision,
        schema_version, state_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const validTimestamp = "2026-08-18T01:02:03.456Z";
    insert.run(
      "legacy-valid",
      "user-1",
      null,
      "C:/repo/valid",
      "draft",
      7,
      3,
      JSON.stringify({ runId: "legacy-valid", outcome: "running" }),
      validTimestamp,
      validTimestamp
    );
    insert.run(
      "legacy-invalid-time",
      "user-1",
      null,
      "C:/repo/invalid",
      "draft",
      2,
      3,
      JSON.stringify({ runId: "legacy-invalid-time" }),
      validTimestamp,
      "not-a-timestamp"
    );
    database.close();

    const repository = new WorkflowJournalSqliteAdapter();
    const legacyValidEvents = await repository.listEvents("legacy-valid");
    expect(legacyValidEvents).toEqual([
      {
        eventId: "legacy_snapshot_imported:legacy-valid",
        runId: "legacy-valid",
        revision: 7,
        eventType: "legacy_snapshot_imported",
        payloadVersion: 1,
        payload: { outcome: "running", runId: "legacy-valid" },
        occurredAtMs: Date.parse(validTimestamp),
      },
    ]);
    const importedEvent = legacyValidEvents[0];
    if (!importedEvent) {
      throw new Error("Expected the imported workflow boundary event");
    }
    expect(
      await repository.append({ event: importedEvent, effects: [] })
    ).toEqual({ event: importedEvent, effects: [] });
    expect(await repository.listEvents("legacy-invalid-time")).toEqual([
      {
        eventId: "legacy_snapshot_imported:legacy-invalid-time",
        runId: "legacy-invalid-time",
        revision: 2,
        eventType: "legacy_snapshot_imported",
        payloadVersion: 1,
        payload: { runId: "legacy-invalid-time" },
        occurredAtMs: 0,
      },
    ]);
  });

  test("migration 0020 backfills base keys and replaces the authority-scoped unique index", async () => {
    const database = new Database(
      path.join(tempStorageDir, "authority-migration.sqlite"),
      { create: true }
    );
    try {
      database.exec(`
        CREATE TABLE workflow_effect_intents (
          effect_id text PRIMARY KEY NOT NULL,
          run_id text NOT NULL,
          authority_id text NOT NULL,
          payload_json text NOT NULL,
          idempotency_key text NOT NULL
        );
        CREATE UNIQUE INDEX idx_workflow_effect_intents_run_idempotency
        ON workflow_effect_intents (run_id, idempotency_key);
      `);
      const insert = database.prepare(`
        INSERT INTO workflow_effect_intents (
          effect_id, run_id, authority_id, payload_json, idempotency_key
        ) VALUES (?, ?, ?, ?, ?)
      `);
      insert.run(
        "effect-before-rotation",
        "run-migration",
        "authority-one",
        JSON.stringify({ intent: { dedupeKey: "logical-operation" } }),
        "authority-one:logical-operation"
      );
      insert.run(
        "effect-after-rotation",
        "run-migration",
        "authority-two",
        JSON.stringify({ intent: { dedupeKey: "logical-operation" } }),
        "authority-two:logical-operation"
      );

      const migrationPath = path.resolve(
        import.meta.dir,
        "../../../../drizzle/0020_workflow_effect_authority_idempotency.sql"
      );
      const migration = await readFile(migrationPath, "utf8");
      database.exec(migration.replaceAll("--> statement-breakpoint", ""));

      expect(
        database
          .query(
            "SELECT authority_id, idempotency_key FROM workflow_effect_intents ORDER BY authority_id"
          )
          .all()
      ).toEqual([
        {
          authority_id: "authority-one",
          idempotency_key: "logical-operation",
        },
        {
          authority_id: "authority-two",
          idempotency_key: "logical-operation",
        },
      ]);
      expect(
        database
          .query(
            "PRAGMA index_info('idx_workflow_effect_intents_run_idempotency')"
          )
          .all()
          .map((row) => (row as { name: string }).name)
      ).toEqual(["run_id", "authority_id", "idempotency_key"]);
      expect(() =>
        insert.run(
          "effect-new-authority",
          "run-migration",
          "authority-three",
          JSON.stringify({ intent: { dedupeKey: "logical-operation" } }),
          "logical-operation"
        )
      ).not.toThrow();
      expect(() =>
        insert.run(
          "effect-duplicate-authority",
          "run-migration",
          "authority-two",
          JSON.stringify({ intent: { dedupeKey: "logical-operation" } }),
          "logical-operation"
        )
      ).toThrow();
    } finally {
      database.close();
    }
  });

  test("fails closed when an existing event identity has different content", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const event = createEvent("run-event-conflict", 0, "run_created");
    const effect = createEffect("effect-event-conflict", "start_turn", 0);
    await repository.append({ event, effects: [effect] });

    await expect(
      repository.append({
        event: { ...event, payload: { changed: true } },
        effects: [effect],
      })
    ).rejects.toThrow();
    await expect(
      repository.append({
        event: { ...event, eventId: "event-same-revision-different-id" },
        effects: [effect],
      })
    ).rejects.toThrow();
    await expect(
      repository.append({
        event,
        effects: [
          withPayload(effect, {
            changed: true,
          }),
        ],
      })
    ).rejects.toThrow();
    expect(await repository.listEvents(event.runId)).toEqual([event]);
  });

  test("rejects a payload hash that does not match canonical effect JSON", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const event = createEvent("run-invalid-hash", 0, "work_ready");
    const effect = {
      ...createEffect("effect-invalid-hash", "start_turn", 0),
      payloadHash: "0".repeat(64),
    };

    await expect(
      repository.append({ event, effects: [effect] })
    ).rejects.toThrow("payload hash mismatch");
    expect(await repository.listEvents(event.runId)).toEqual([]);
    expect(await repository.listEffects(event.runId)).toEqual([]);
  });

  test("rolls back a new event on a conflicting effect idempotency key", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const event = createEvent("run-conflict", 0, "run_created");
    const first = createEffect("effect-conflict-1", "start_turn", 0);
    await repository.append({ event, effects: [first] });

    const nextEvent = createEvent("run-conflict", 1, "work_ready");
    const conflicting = {
      ...createEffect("effect-conflict-2", "start_turn", 0),
      idempotencyKey: first.idempotencyKey,
    };

    await expect(
      repository.append({ event: nextEvent, effects: [conflicting] })
    ).rejects.toThrow();
    expect(await repository.listEvents(event.runId)).toEqual([event]);
    expect(
      (await repository.listEffects(event.runId)).map(
        (effect) => effect.effectId
      )
    ).toEqual([first.effectId]);
  });

  test("releases every prior-process claim that has not started handler IO", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const event = createEvent("run-release-pending", 0, "work_ready");
    await repository.append({
      event,
      effects: [
        createEffect("effect-pending", "run_verification", 0),
        createEffect("effect-started", "start_turn", 0),
      ],
    });
    await repository.claimDueEffects({
      nowMs: 0,
      claimToken: "claim-prior-process",
      leaseDurationMs: 1000,
      limit: 10,
    });
    await repository.markEffectStarted({
      effectId: "effect-started",
      claimToken: "claim-prior-process",
      startedAtMs: 1,
      leaseExpiresAtMs: 1000,
    });

    const released = await repository.releasePendingEffectClaims({ nowMs: 2 });
    expect(released.map((effect) => effect.effectId)).toEqual([
      "effect-pending",
    ]);
    expect(released[0]).toMatchObject({
      status: "pending",
      updatedAtMs: 2,
    });
    expect(released[0]?.claimToken).toBeUndefined();
    expect(released[0]?.claimedAtMs).toBeUndefined();
    expect(released[0]?.leaseExpiresAtMs).toBeUndefined();
    expect(await repository.getEffect("effect-started")).toMatchObject({
      status: "started",
      claimToken: "claim-prior-process",
    });
    expect(
      (
        await repository.claimDueEffects({
          nowMs: 2,
          claimToken: "claim-current-process",
          leaseDurationMs: 10,
          limit: 10,
        })
      ).map((effect) => effect.effectId)
    ).toEqual(["effect-pending"]);
  });

  test("claims due effects with leases and uses compare-and-set lifecycle updates", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const event = createEvent("run-claim", 0, "work_ready");
    await repository.append({
      event,
      effects: [
        createEffect("effect-due-1", "start_turn", 100),
        createEffect("effect-due-2", "run_verification", 100),
        createEffect("effect-future", "schedule_wakeup", 500),
      ],
    });

    const claimed = await repository.claimDueEffects({
      nowMs: 100,
      claimToken: "claim-1",
      leaseDurationMs: 50,
      limit: 10,
    });
    expect(claimed.map((effect) => effect.effectId)).toEqual([
      "effect-due-1",
      "effect-due-2",
    ]);
    expect(
      await repository.claimDueEffects({
        nowMs: 100,
        claimToken: "claim-2",
        leaseDurationMs: 50,
        limit: 10,
      })
    ).toEqual([]);

    expect(
      await repository.markEffectStarted({
        effectId: "effect-due-1",
        claimToken: "wrong-claim",
        startedAtMs: 110,
        leaseExpiresAtMs: 200,
      })
    ).toBeNull();
    const started = await repository.markEffectStarted({
      effectId: "effect-due-1",
      claimToken: "claim-1",
      startedAtMs: 110,
      leaseExpiresAtMs: 200,
    });
    expect(started).toMatchObject({
      status: "started",
      attemptCount: 1,
      startedAtMs: 110,
    });
    expect(
      await repository.markEffectSucceeded({
        effectId: "effect-due-1",
        claimToken: "claim-1",
        finishedAtMs: 130,
      })
    ).toMatchObject({
      status: "succeeded",
    });

    const reclaimed = await repository.claimDueEffects({
      nowMs: 151,
      claimToken: "claim-2",
      leaseDurationMs: 50,
      limit: 10,
    });
    expect(reclaimed.map((effect) => effect.effectId)).toEqual([
      "effect-due-2",
    ]);
    await repository.markEffectStarted({
      effectId: "effect-due-2",
      claimToken: "claim-2",
      startedAtMs: 151,
      leaseExpiresAtMs: 210,
    });
    expect(
      await repository.markEffectFailed({
        effectId: "effect-due-2",
        claimToken: "claim-2",
        finishedAtMs: 160,
        error: { code: "VERIFICATION_FAILED" },
      })
    ).toMatchObject({
      status: "failed",
      lastError: { code: "VERIFICATION_FAILED" },
    });
  });

  test("moves only stale started send or resume effects to uncertain", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const event = createEvent("run-uncertain", 0, "work_ready");
    await repository.append({
      event,
      effects: [
        createEffect("effect-send", "start_turn", 0),
        createEffect("effect-resume", "resume_session", 0),
        createEffect("effect-safe", "run_verification", 0),
      ],
    });
    const claimed = await repository.claimDueEffects({
      nowMs: 0,
      claimToken: "claim-stale",
      leaseDurationMs: 10,
      limit: 10,
    });
    for (const effect of claimed) {
      await repository.markEffectStarted({
        effectId: effect.effectId,
        claimToken: "claim-stale",
        startedAtMs: 1,
        leaseExpiresAtMs: 10,
      });
    }

    const uncertain = await repository.markStaleStartedDispatchesUncertain({
      effectTypes: ["start_turn", "resume_session"],
      nowMs: 11,
      error: { code: "DISPATCH_ACK_UNKNOWN" },
    });
    expect(uncertain.map((effect) => effect.effectId).sort()).toEqual([
      "effect-resume",
      "effect-send",
    ]);
    expect(await repository.getEffect("effect-safe")).toMatchObject({
      status: "started",
    });
    expect(
      await repository.claimDueEffects({
        nowMs: 100,
        claimToken: "claim-after-restart",
        leaseDurationMs: 10,
        limit: 10,
      })
    ).toEqual([]);

    expect(
      await repository.markEffectSucceeded({
        effectId: "effect-send",
        finishedAtMs: 120,
      })
    ).toMatchObject({
      status: "succeeded",
    });
    expect(
      await repository.markEffectUncertain({
        effectId: "effect-safe",
        claimToken: "claim-stale",
        finishedAtMs: 120,
        error: { code: "RESULT_UNKNOWN" },
      })
    ).toMatchObject({ status: "uncertain" });
  });

  test("startup recovery can invalidate every known unexpired started effect lease", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const event = createEvent("run-startup-recovery", 0, "work_ready");
    await repository.append({
      event,
      effects: [
        createEffect("effect-startup-send", "start_turn", 0),
        createEffect("effect-startup-resume", "resume_session", 0),
        createEffect("effect-startup-safe", "run_verification", 0),
      ],
    });
    const claimed = await repository.claimDueEffects({
      nowMs: 0,
      claimToken: "claim-prior-process",
      leaseDurationMs: 1000,
      limit: 10,
    });
    for (const effect of claimed) {
      await repository.markEffectStarted({
        effectId: effect.effectId,
        claimToken: "claim-prior-process",
        startedAtMs: 1,
        leaseExpiresAtMs: 1000,
      });
    }

    expect(
      await repository.markStaleStartedDispatchesUncertain({
        effectTypes: [...KNOWN_WORKFLOW_EFFECT_TYPES],
        nowMs: 10,
        error: { code: "PRIOR_PROCESS_EXITED" },
      })
    ).toEqual([]);
    const uncertain = await repository.markStaleStartedDispatchesUncertain({
      effectTypes: [...KNOWN_WORKFLOW_EFFECT_TYPES],
      nowMs: 10,
      error: { code: "PRIOR_PROCESS_EXITED" },
      includeUnexpired: true,
    });
    expect(uncertain.map((effect) => effect.effectId).sort()).toEqual([
      "effect-startup-resume",
      "effect-startup-safe",
      "effect-startup-send",
    ]);
    expect(await repository.getEffect("effect-startup-safe")).toMatchObject({
      status: "uncertain",
      leaseExpiresAtMs: 1000,
    });
  });

  test("atomically creates and CAS-saves a Supervisor snapshot with its contiguous journal", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const snapshotRepository = new SupervisorRunSqliteRepository();
    const initial = createSupervisorRunFixture({ runId: "run-uow" });
    const initialEvent = createSnapshotEvent(initial, "supervisor_run_created");
    const initialEffect = {
      ...createEffect("effect-uow-start", "start_turn", 0),
      authorityId: "goal-revision-1",
    };

    const created = await repository.commitRunTransition({
      expectedRevision: null,
      snapshot: initial,
      event: initialEvent,
      effects: [initialEffect],
    });
    expect(created).toMatchObject({
      created: true,
      previousRevision: null,
      committedRevision: 0,
      snapshot: initial,
      event: initialEvent,
    });
    expect(created.effects).toMatchObject([
      {
        effectId: initialEffect.effectId,
        authorityId: "goal-revision-1",
        status: "pending",
      },
    ]);
    expect(await snapshotRepository.get(initial.runId, initial.userId)).toEqual(
      initial
    );

    await expect(
      repository.commitRunTransition({
        expectedRevision: null,
        snapshot: initial,
        event: initialEvent,
        effects: [initialEffect],
      })
    ).resolves.toEqual(created);
    await expect(
      repository.commitRunTransition({
        expectedRevision: null,
        snapshot: {
          ...initial,
          originalIntent: "Conflicting content at the same aggregate revision",
        },
        event: initialEvent,
        effects: [initialEffect],
      })
    ).rejects.toMatchObject({
      name: "WorkflowJournalConflictError",
      code: "WORKFLOW_JOURNAL_CONFLICT",
    });

    const revisionOne = transitionSupervisorRun(initial, {
      expectedRevision: 0,
      now: "2026-07-11T00:01:00.000Z",
      mutate() {
        // A durable reconciliation checkpoint may advance without changing facts.
      },
    });
    const revisionOneEvent = createSnapshotEvent(
      revisionOne,
      "supervisor_run_reconciled"
    );
    const saved = await repository.commitRunTransition({
      expectedRevision: 0,
      snapshot: revisionOne,
      event: revisionOneEvent,
      effects: [],
    });
    expect(saved).toMatchObject({
      created: false,
      previousRevision: 0,
      committedRevision: 1,
      snapshot: revisionOne,
      event: revisionOneEvent,
      effects: [],
    });
    expect(
      await snapshotRepository.get(revisionOne.runId, revisionOne.userId)
    ).toEqual(revisionOne);
    expect(await repository.listEvents(initial.runId)).toEqual([
      initialEvent,
      revisionOneEvent,
    ]);
  });

  test("rolls back the Supervisor snapshot when effect materialization conflicts", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const snapshotRepository = new SupervisorRunSqliteRepository();
    const initial = createSupervisorRunFixture({
      runId: "run-uow-rollback",
    });
    const initialEvent = createSnapshotEvent(initial, "supervisor_run_created");
    const initialEffect = createEffect("effect-existing", "start_turn", 0);
    await repository.commitRunTransition({
      expectedRevision: null,
      snapshot: initial,
      event: initialEvent,
      effects: [initialEffect],
    });

    const revisionOne = transitionSupervisorRun(initial, {
      expectedRevision: 0,
      now: "2026-07-11T00:01:00.000Z",
      mutate() {
        // Exercise transaction rollback after the snapshot update has executed.
      },
    });
    const conflictingEffect = {
      ...createEffect("effect-colliding", "run_verification", 1),
      idempotencyKey: initialEffect.idempotencyKey,
    };
    await expect(
      repository.commitRunTransition({
        expectedRevision: 0,
        snapshot: revisionOne,
        event: createSnapshotEvent(revisionOne, "supervisor_run_reconciled"),
        effects: [conflictingEffect],
      })
    ).rejects.toThrow();

    expect(await snapshotRepository.get(initial.runId, initial.userId)).toEqual(
      initial
    );
    expect(await repository.listEvents(initial.runId)).toEqual([initialEvent]);
    expect(
      (await repository.listEffects(initial.runId)).map(
        (effect) => effect.effectId
      )
    ).toEqual([initialEffect.effectId]);
  });

  test("scopes a base logical idempotency key by authority and normalizes same-authority collisions", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const snapshotRepository = new SupervisorRunSqliteRepository();
    const initial = createSupervisorRunFixture({
      runId: "run-authority-idempotency",
    });
    const firstEffect = {
      ...createEffect("effect-authority-one", "request_plan", 0),
      authorityId: "authority-one",
      idempotencyKey: "logical-operation",
    };
    await repository.commitRunTransition({
      expectedRevision: null,
      snapshot: initial,
      event: createSnapshotEvent(initial, "supervisor_run_created"),
      effects: [firstEffect],
    });

    const revisionOne = transitionSupervisorRun(initial, {
      expectedRevision: 0,
      now: "2026-07-11T00:01:00.000Z",
      mutate() {
        // Rotating authority intentionally permits the same logical operation.
      },
    });
    const rotatedEffect = {
      ...createEffect("effect-authority-two", "request_plan", 1),
      authorityId: "authority-two",
      idempotencyKey: "logical-operation",
    };
    await expect(
      repository.commitRunTransition({
        expectedRevision: 0,
        snapshot: revisionOne,
        event: createSnapshotEvent(revisionOne, "workflow_authority_rotated"),
        effects: [rotatedEffect],
      })
    ).resolves.toMatchObject({ committedRevision: 1 });
    expect(await repository.listEffects(initial.runId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectId: firstEffect.effectId,
          authorityId: "authority-one",
          idempotencyKey: "logical-operation",
        }),
        expect.objectContaining({
          effectId: rotatedEffect.effectId,
          authorityId: "authority-two",
          idempotencyKey: "logical-operation",
        }),
      ])
    );

    const revisionTwo = transitionSupervisorRun(revisionOne, {
      expectedRevision: 1,
      now: "2026-07-11T00:02:00.000Z",
      mutate() {
        // The collision must roll this candidate snapshot back.
      },
    });
    await expect(
      repository.commitRunTransition({
        expectedRevision: 1,
        snapshot: revisionTwo,
        event: createSnapshotEvent(
          revisionTwo,
          "workflow_effects_materialized"
        ),
        effects: [
          {
            ...createEffect(
              "effect-authority-two-duplicate",
              "request_plan",
              2
            ),
            authorityId: "authority-two",
            idempotencyKey: "logical-operation",
          },
        ],
      })
    ).rejects.toMatchObject({
      name: "WorkflowJournalConflictError",
      code: "WORKFLOW_JOURNAL_CONFLICT",
    });
    expect(await snapshotRepository.get(initial.runId, initial.userId)).toEqual(
      revisionOne
    );
  });

  test("enforces a contiguous event head for standalone journal appends", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const runId = "run-contiguous";

    await expect(
      repository.append({
        event: createEvent(runId, 1, "out_of_order"),
        effects: [],
      })
    ).rejects.toThrow();
    const first = createEvent(runId, 0, "run_created");
    await repository.append({ event: first, effects: [] });
    await expect(
      repository.append({
        event: createEvent(runId, 2, "gap"),
        effects: [],
      })
    ).rejects.toThrow();
    expect(await repository.listEvents(runId)).toEqual([first]);
  });

  test("atomically commits an effect result, snapshot, result event, and follow-up intents", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const snapshotRepository = new SupervisorRunSqliteRepository();
    const initial = createSupervisorRunFixture({
      runId: "run-effect-result",
    });
    const initialEvent = createSnapshotEvent(initial, "supervisor_run_created");
    const sourceEffect = {
      ...createEffect("effect-source", "start_turn", 0),
      authorityId: "work-item-1",
    };
    await repository.commitRunTransition({
      expectedRevision: null,
      snapshot: initial,
      event: initialEvent,
      effects: [sourceEffect],
    });
    await repository.claimDueEffects({
      nowMs: 0,
      claimToken: "claim-source",
      leaseDurationMs: 100,
      limit: 1,
    });
    await repository.markEffectStarted({
      effectId: sourceEffect.effectId,
      claimToken: "claim-source",
      startedAtMs: 1,
      leaseExpiresAtMs: 100,
    });

    const revisionOne = transitionSupervisorRun(initial, {
      expectedRevision: 0,
      now: "2026-07-11T00:01:00.000Z",
      mutate() {
        // The result event itself is the durable fact for this checkpoint.
      },
    });
    const resultEvent = createSnapshotEvent(
      revisionOne,
      "workflow_effect_succeeded"
    );
    const followUpEffect = {
      ...createEffect("effect-follow-up", "run_verification", 2),
      authorityId: "work-item-1",
    };
    const input = {
      transition: {
        expectedRevision: 0,
        snapshot: revisionOne,
        event: resultEvent,
        effects: [followUpEffect],
      },
      terminalEffect: {
        effectId: sourceEffect.effectId,
        claimToken: "claim-source",
        status: "succeeded" as const,
        finishedAtMs: Date.parse(revisionOne.updatedAt),
      },
    };

    await expect(
      repository.commitEffectResult({
        ...input,
        terminalEffect: {
          ...input.terminalEffect,
          claimToken: "wrong-claim",
        },
      })
    ).rejects.toThrow();
    expect(await snapshotRepository.get(initial.runId, initial.userId)).toEqual(
      initial
    );
    expect(await repository.listEvents(initial.runId)).toEqual([initialEvent]);

    const committed = await repository.commitEffectResult(input);
    expect(committed).toMatchObject({
      created: false,
      previousRevision: 0,
      committedRevision: 1,
      snapshot: revisionOne,
      event: resultEvent,
      effects: [{ effectId: followUpEffect.effectId, status: "pending" }],
      effect: {
        effectId: sourceEffect.effectId,
        status: "succeeded",
        resultEventId: resultEvent.eventId,
      },
    });
    await expect(repository.commitEffectResult(input)).resolves.toEqual(
      committed
    );
    expect(
      await snapshotRepository.get(revisionOne.runId, revisionOne.userId)
    ).toEqual(revisionOne);
    expect(await repository.listEvents(initial.runId)).toEqual([
      initialEvent,
      resultEvent,
    ]);
  });

  test("cancels only pending effects owned by the selected run authority", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const runId = "run-cancel-authority";
    const event = createEvent(runId, 0, "work_ready");
    await repository.append({
      event,
      effects: [
        {
          ...createEffect("effect-a-0-started", "start_turn", 0),
          authorityId: "work-item-a",
        },
        {
          ...createEffect("effect-a-1-pending", "run_verification", 0),
          authorityId: "work-item-a",
        },
        {
          ...createEffect("effect-b-pending", "run_verification", 0),
          authorityId: "work-item-b",
        },
      ],
    });
    await repository.claimDueEffects({
      nowMs: 0,
      claimToken: "claim-started",
      leaseDurationMs: 100,
      limit: 1,
    });
    await repository.markEffectStarted({
      effectId: "effect-a-0-started",
      claimToken: "claim-started",
      startedAtMs: 1,
      leaseExpiresAtMs: 100,
    });

    const cancelled = await repository.cancelPendingEffects({
      runId,
      authorityId: "work-item-a",
      cancelledAtMs: 2,
      reason: { code: "AUTHORITY_REVOKED" },
    });
    expect(cancelled).toMatchObject([
      {
        effectId: "effect-a-1-pending",
        authorityId: "work-item-a",
        status: "cancelled",
        finishedAtMs: 2,
        lastError: { code: "AUTHORITY_REVOKED" },
      },
    ]);
    expect(await repository.getEffect("effect-a-0-started")).toMatchObject({
      status: "started",
    });
    expect(await repository.getEffect("effect-b-pending")).toMatchObject({
      status: "pending",
    });
    await expect(
      repository.cancelPendingEffects({
        runId,
        authorityId: "work-item-a",
        cancelledAtMs: 3,
      })
    ).resolves.toEqual([]);
  });

  test("rejects an effect result event from a missing or different run", async () => {
    const repository = new WorkflowJournalSqliteAdapter();
    const runId = "run-result-reference";
    await repository.append({
      event: createEvent(runId, 0, "work_ready"),
      effects: [createEffect("effect-reference", "start_turn", 0)],
    });
    await repository.claimDueEffects({
      nowMs: 0,
      claimToken: "claim-reference",
      leaseDurationMs: 100,
      limit: 1,
    });
    await repository.markEffectStarted({
      effectId: "effect-reference",
      claimToken: "claim-reference",
      startedAtMs: 1,
      leaseExpiresAtMs: 100,
    });

    await expect(
      repository.markEffectSucceeded({
        effectId: "effect-reference",
        claimToken: "claim-reference",
        finishedAtMs: 2,
        resultEventId: "missing-event",
      })
    ).rejects.toThrow();
    const otherRunEvent = createEvent("run-other", 0, "result_recorded");
    await repository.append({ event: otherRunEvent, effects: [] });
    await expect(
      repository.markEffectSucceeded({
        effectId: "effect-reference",
        claimToken: "claim-reference",
        finishedAtMs: 2,
        resultEventId: otherRunEvent.eventId,
      })
    ).rejects.toThrow();
    expect(await repository.getEffect("effect-reference")).toMatchObject({
      status: "started",
    });
  });
});

function createEvent(
  runId: string,
  revision: number,
  eventType: string
): WorkflowEventInput {
  return {
    eventId: `event-${runId}-${revision}`,
    runId,
    revision,
    eventType,
    payloadVersion: 1,
    payload: { runId, revision },
    occurredAtMs: revision,
  };
}

function createSnapshotEvent(
  snapshot: ReturnType<typeof createSupervisorRunFixture>,
  eventType: string
): WorkflowEventInput {
  return {
    eventId: `event-${snapshot.runId}-${snapshot.revision}`,
    runId: snapshot.runId,
    revision: snapshot.revision,
    eventType,
    payloadVersion: 1,
    payload: { runId: snapshot.runId, revision: snapshot.revision },
    occurredAtMs: Date.parse(snapshot.updatedAt),
  };
}

function createEffect(
  effectId: string,
  effectType: string,
  notBeforeMs: number
): WorkflowEffectIntentInput {
  const payload = { effectId };
  return {
    effectId,
    effectType,
    payloadVersion: 1,
    payload,
    payloadHash: computeWorkflowPayloadHash(payload),
    promptHash: PROMPT_HASH,
    idempotencyKey: `idempotency-${effectId}`,
    notBeforeMs,
    attemptId: `attempt-${effectId}`,
    sessionId: `session-${effectId}`,
    workspaceId: `workspace-${effectId}`,
    createdAtMs: notBeforeMs,
  };
}

function withPayload(
  effect: WorkflowEffectIntentInput,
  payload: WorkflowJsonValue
): WorkflowEffectIntentInput {
  return {
    ...effect,
    payload,
    payloadHash: computeWorkflowPayloadHash(payload),
  };
}

async function removeTempDirWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      if (!(code === "EBUSY" || code === "EPERM")) {
        throw error;
      }
      if (attempt === 9) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
