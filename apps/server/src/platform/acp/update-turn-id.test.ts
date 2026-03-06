import { afterEach, describe, expect, test } from "bun:test";
import {
  getTurnIdMigrationSnapshot,
  recordTurnIdDrop,
  recordTurnIdResolution,
  resetTurnIdMigrationSnapshotForTests,
} from "./turn-id-observability";
import {
  readTurnIdFromMeta,
  resolveSessionUpdateTurnId,
  resolveToolCallTurnId,
} from "./update-turn-id";

describe("turn-id resolution", () => {
  afterEach(() => {
    resetTurnIdMigrationSnapshotForTests();
  });

  test("prefers native turnId over _meta fallback", () => {
    expect(
      resolveSessionUpdateTurnId({
        sessionUpdate: "agent_message_chunk",
        turnId: "turn-native",
        _meta: { turnId: "turn-meta" },
        content: {
          type: "text",
          text: "hello",
        },
      } as never)
    ).toEqual({
      source: "native",
      turnId: "turn-native",
    });
  });

  test("falls back to supported _meta aliases when native field is absent", () => {
    expect(readTurnIdFromMeta({ turn_id: "turn-meta" })).toBe("turn-meta");
    expect(
      resolveToolCallTurnId({
        _meta: { "turn-id": "turn-meta" },
      })
    ).toEqual({
      source: "meta",
      turnId: "turn-meta",
    });
  });

  test("tracks migration counters by ingress channel", () => {
    recordTurnIdResolution("sessionUpdate", "native");
    recordTurnIdResolution("sessionUpdate", "meta");
    recordTurnIdResolution("permissionRequest", "missing");
    recordTurnIdDrop("requireNativePolicy");

    expect(getTurnIdMigrationSnapshot()).toEqual({
      sessionUpdates: {
        native: 1,
        metaFallback: 1,
        missing: 0,
      },
      permissionRequests: {
        native: 0,
        metaFallback: 0,
        missing: 1,
      },
      drops: {
        requireNativePolicy: 1,
        staleTurnMismatch: 0,
        lateAfterTurnCleared: 0,
      },
    });
  });
});
