import { describe, expect, test } from "bun:test";
import type {
  WorkflowEffectRecord,
  WorkflowEffectStatus,
} from "./contracts/workflow-journal.contract";
import {
  EffectExecutor,
  WorkflowEffectUncertainError,
} from "./effect-executor";
import type { WorkflowJournalPort } from "./ports/workflow-journal.port";

const PAYLOAD_HASH = "a".repeat(64);

describe("EffectExecutor", () => {
  test("claims, marks started before handler IO, and persists success with CAS", async () => {
    const harness = createJournalHarness([
      createEffect("effect-1", "start_turn"),
    ]);
    const executor = new EffectExecutor({
      journal: harness.journal,
      handlers: {
        start_turn: ({ effect, claimToken }) => {
          harness.order.push(`handler:${effect.effectId}:${effect.status}`);
          expect(claimToken).toBe("claim-1");
          return {
            outcome: "succeeded",
            resultEventId: "result-event-1",
          };
        },
      },
      now: () => 100,
      createClaimToken: () => "claim-1",
      leaseDurationMs: 50,
    });

    const result = await executor.executeDueEffects({ nowMs: 100, limit: 5 });

    expect(harness.order).toEqual([
      "claim:claim-1",
      "start:effect-1:claim-1",
      "handler:effect-1:started",
      "succeeded:effect-1:claim-1",
    ]);
    expect(harness.calls.claim[0]).toEqual({
      nowMs: 100,
      claimToken: "claim-1",
      leaseDurationMs: 50,
      limit: 5,
    });
    expect(harness.calls.started[0]?.leaseExpiresAtMs).toBe(150);
    expect(harness.calls.succeeded[0]?.resultEventId).toBe("result-event-1");
    expect(result).toMatchObject({
      claimToken: "claim-1",
      claimedEffectIds: ["effect-1"],
      effects: [{ outcome: "succeeded", effect: { status: "succeeded" } }],
    });
  });

  test("holds the claimed-effect boundary through durable result persistence", async () => {
    const harness = createJournalHarness([
      createEffect("effect-boundary", "integrate_workspace"),
    ]);
    const executor = new EffectExecutor({
      journal: harness.journal,
      handlers: {
        integrate_workspace: () => {
          harness.order.push("external-io");
          return { outcome: "succeeded" };
        },
      },
      executeClaimedEffect: async ({ effect }, execute) => {
        harness.order.push(`boundary-enter:${effect.effectId}`);
        const result = await execute();
        harness.order.push(`boundary-release:${effect.effectId}`);
        return result;
      },
      now: () => 100,
      createClaimToken: () => "claim-boundary",
    });

    await executor.executeDueEffects({ nowMs: 100 });

    expect(harness.order).toEqual([
      "claim:claim-boundary",
      "start:effect-boundary:claim-boundary",
      "boundary-enter:effect-boundary",
      "external-io",
      "succeeded:effect-boundary:claim-boundary",
      "boundary-release:effect-boundary",
    ]);
  });

  test("persists handler failures and both explicit uncertain contracts without stopping the batch", async () => {
    const harness = createJournalHarness([
      createEffect("effect-failed", "throws"),
      createEffect("effect-uncertain-error", "uncertain_error"),
      createEffect("effect-uncertain-result", "uncertain_result"),
      createEffect("effect-later", "later"),
    ]);
    const executor = new EffectExecutor({
      journal: harness.journal,
      handlers: {
        throws: () => {
          throw new Error("handler exploded");
        },
        uncertain_error: () => {
          throw new WorkflowEffectUncertainError({ code: "ACK_UNKNOWN" });
        },
        uncertain_result: () => ({
          outcome: "uncertain",
          error: { code: "REMOTE_RESULT_UNKNOWN" },
        }),
        later: () => ({ outcome: "succeeded" }),
      },
      now: () => 200,
      createClaimToken: () => "claim-batch",
    });

    const result = await executor.executeDueEffects({ nowMs: 200 });

    expect(result.effects.map((effect) => effect.outcome)).toEqual([
      "failed",
      "uncertain",
      "uncertain",
      "succeeded",
    ]);
    expect(harness.calls.failed[0]?.error).toEqual({
      code: "WORKFLOW_EFFECT_HANDLER_FAILED",
      name: "Error",
      message: "handler exploded",
    });
    expect(harness.calls.uncertain.map((call) => call.error)).toEqual([
      { code: "ACK_UNKNOWN" },
      { code: "REMOTE_RESULT_UNKNOWN" },
    ]);
    expect(harness.records.get("effect-later")?.status).toBe("succeeded");
  });

  test("fails an unknown effect type closed and continues known handlers", async () => {
    const harness = createJournalHarness([
      createEffect("effect-unknown", "unknown_effect"),
      createEffect("effect-known", "known_effect"),
    ]);
    const executor = new EffectExecutor({
      journal: harness.journal,
      handlers: {
        known_effect: () => ({ outcome: "succeeded" }),
      },
      now: () => 300,
      createClaimToken: () => "claim-unknown",
    });

    const result = await executor.executeDueEffects({ nowMs: 300 });

    expect(result.effects.map((effect) => effect.outcome)).toEqual([
      "failed",
      "succeeded",
    ]);
    expect(harness.calls.failed[0]?.error).toEqual({
      code: "WORKFLOW_EFFECT_HANDLER_NOT_FOUND",
      effectType: "unknown_effect",
    });
    expect(harness.records.get("effect-unknown")?.status).toBe("failed");
  });

  test("reports start and finish CAS conflicts without running or stopping unrelated effects", async () => {
    const harness = createJournalHarness(
      [
        createEffect("effect-start-lost", "work"),
        createEffect("effect-finish-lost", "work"),
        createEffect("effect-ok", "work"),
      ],
      {
        startCasMisses: new Set(["effect-start-lost"]),
        finishCasMisses: new Set(["effect-finish-lost"]),
      }
    );
    const handled: string[] = [];
    const executor = new EffectExecutor({
      journal: harness.journal,
      handlers: {
        work: ({ effect }) => {
          handled.push(effect.effectId);
          return { outcome: "succeeded" };
        },
      },
      now: () => 400,
      createClaimToken: () => "claim-cas",
    });

    const result = await executor.executeDueEffects({ nowMs: 400 });

    expect(handled).toEqual(["effect-finish-lost", "effect-ok"]);
    expect(result.effects).toMatchObject([
      { outcome: "cas_conflict", phase: "start" },
      {
        outcome: "cas_conflict",
        phase: "finish",
        attemptedOutcome: "succeeded",
      },
      { outcome: "succeeded" },
    ]);
  });
});

interface JournalHarnessOptions {
  startCasMisses?: ReadonlySet<string>;
  finishCasMisses?: ReadonlySet<string>;
}

function createJournalHarness(
  effects: WorkflowEffectRecord[],
  options: JournalHarnessOptions = {}
) {
  const records = new Map(
    effects.map((effect) => [effect.effectId, structuredClone(effect)])
  );
  const calls = {
    claim: [] as Parameters<WorkflowJournalPort["claimDueEffects"]>[0][],
    started: [] as Parameters<WorkflowJournalPort["markEffectStarted"]>[0][],
    succeeded: [] as Parameters<
      WorkflowJournalPort["markEffectSucceeded"]
    >[0][],
    failed: [] as Parameters<WorkflowJournalPort["markEffectFailed"]>[0][],
    uncertain: [] as Parameters<
      WorkflowJournalPort["markEffectUncertain"]
    >[0][],
  };
  const order: string[] = [];
  const journal: WorkflowJournalPort = {
    append: () => Promise.reject(new Error("Unused journal method")),
    getEvent: () => Promise.resolve(null),
    listEvents: () => Promise.resolve([]),
    getEffect: (effectId) =>
      Promise.resolve(structuredClone(records.get(effectId) ?? null)),
    listEffects: () => Promise.resolve([]),
    claimDueEffects: (input) => {
      calls.claim.push(input);
      order.push(`claim:${input.claimToken}`);
      const claimed = [...records.values()]
        .filter(
          (effect) =>
            effect.status === "pending" && effect.notBeforeMs <= input.nowMs
        )
        .slice(0, input.limit)
        .map((effect) => {
          const next: WorkflowEffectRecord = {
            ...effect,
            claimToken: input.claimToken,
            claimedAtMs: input.nowMs,
            leaseExpiresAtMs: input.nowMs + input.leaseDurationMs,
            updatedAtMs: input.nowMs,
          };
          records.set(next.effectId, next);
          return structuredClone(next);
        });
      return Promise.resolve(claimed);
    },
    markEffectStarted: (input) => {
      calls.started.push(input);
      order.push(`start:${input.effectId}:${input.claimToken}`);
      const current = records.get(input.effectId);
      if (
        !current ||
        options.startCasMisses?.has(input.effectId) ||
        current.status !== "pending" ||
        current.claimToken !== input.claimToken
      ) {
        return Promise.resolve(null);
      }
      const next: WorkflowEffectRecord = {
        ...current,
        status: "started",
        attemptCount: current.attemptCount + 1,
        startedAtMs: input.startedAtMs,
        leaseExpiresAtMs: input.leaseExpiresAtMs,
        updatedAtMs: input.startedAtMs,
      };
      records.set(next.effectId, next);
      return Promise.resolve(structuredClone(next));
    },
    markEffectSucceeded: (input) => {
      calls.succeeded.push(input);
      order.push(`succeeded:${input.effectId}:${input.claimToken}`);
      return finishEffect(records, input, "succeeded", options.finishCasMisses);
    },
    markEffectFailed: (input) => {
      calls.failed.push(input);
      order.push(`failed:${input.effectId}:${input.claimToken}`);
      return finishEffect(
        records,
        input,
        "failed",
        options.finishCasMisses,
        input.error
      );
    },
    markEffectUncertain: (input) => {
      calls.uncertain.push(input);
      order.push(`uncertain:${input.effectId}:${input.claimToken}`);
      return finishEffect(
        records,
        input,
        "uncertain",
        options.finishCasMisses,
        input.error
      );
    },
    markStaleStartedDispatchesUncertain: () => Promise.resolve([]),
    releasePendingEffectClaims: () => Promise.resolve([]),
  };
  return { journal, calls, order, records };
}

function finishEffect(
  records: Map<string, WorkflowEffectRecord>,
  input: {
    effectId: string;
    claimToken?: string;
    finishedAtMs: number;
    resultEventId?: string;
  },
  status: Extract<WorkflowEffectStatus, "succeeded" | "failed" | "uncertain">,
  casMisses?: ReadonlySet<string>,
  error?: WorkflowEffectRecord["lastError"]
): Promise<WorkflowEffectRecord | null> {
  const current = records.get(input.effectId);
  if (
    !current ||
    casMisses?.has(input.effectId) ||
    current.status !== "started" ||
    current.claimToken !== input.claimToken
  ) {
    return Promise.resolve(null);
  }
  const next: WorkflowEffectRecord = {
    ...current,
    status,
    finishedAtMs: input.finishedAtMs,
    updatedAtMs: input.finishedAtMs,
    ...(input.resultEventId ? { resultEventId: input.resultEventId } : {}),
    ...(error === undefined ? {} : { lastError: error }),
  };
  records.set(next.effectId, next);
  return Promise.resolve(structuredClone(next));
}

function createEffect(
  effectId: string,
  effectType: string
): WorkflowEffectRecord {
  return {
    effectId,
    runId: "run-1",
    authorityId: "run-1",
    sourceEventId: "source-event-1",
    effectType,
    payloadVersion: 1,
    payload: { effectId },
    payloadHash: PAYLOAD_HASH,
    idempotencyKey: `idempotency-${effectId}`,
    status: "pending",
    notBeforeMs: 0,
    attemptCount: 0,
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}
