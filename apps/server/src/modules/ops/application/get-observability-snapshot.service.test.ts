import { afterEach, describe, expect, test } from "bun:test";
import type { SessionRuntimePort } from "@/modules/session";
import {
  getTurnIdMigrationSnapshot,
  recordTurnIdDrop,
  recordTurnIdResolution,
  resetTurnIdMigrationSnapshotForTests,
} from "@/platform/acp/turn-id-observability";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { LogEntry } from "@/shared/types/log.types";
import { GetObservabilitySnapshotService } from "./get-observability-snapshot.service";

describe("GetObservabilitySnapshotService", () => {
  afterEach(() => {
    resetTurnIdMigrationSnapshotForTests();
  });

  test("includes ACP turn-id migration telemetry in per-user observability snapshots", async () => {
    const entries: LogEntry[] = [
      {
        id: "log-1",
        timestamp: Date.now(),
        level: "warn",
        message: "warn",
        userId: "user-1",
        source: "http",
        request: {
          method: "GET",
          path: "/health",
          status: 200,
          durationMs: 12,
        },
      },
    ];
    const sessionRuntime = {
      getAll: () => [
        {
          id: "chat-1",
          userId: "user-1",
          subscriberCount: 1,
          pendingPermissions: new Map(),
        },
        {
          id: "chat-2",
          userId: "user-2",
          subscriberCount: 0,
          pendingPermissions: new Map([["req-1", {}]]),
        },
      ],
    } as unknown as SessionRuntimePort;
    const logStore = {
      append: () => undefined,
      list: () => ({
        entries,
        stats: {
          total: entries.length,
          levels: {
            debug: 0,
            info: 0,
            warn: 1,
            error: 0,
          },
        },
      }),
      query: async (query) => ({
        entries:
          query?.userId === "user-1"
            ? entries
            : entries.filter((entry) => entry.userId === query?.userId),
        stats: {
          total: query?.userId === "user-1" ? entries.length : 0,
          levels: {
            debug: 0,
            info: 0,
            warn: 1,
            error: 0,
          },
        },
      }),
      subscribe: () => () => undefined,
      flush: async () => undefined,
    } satisfies LogStorePort;

    recordTurnIdResolution("sessionUpdate", "meta");
    recordTurnIdResolution("permissionRequest", "native");
    recordTurnIdDrop("staleTurnMismatch");

    const service = new GetObservabilitySnapshotService({
      sessionRuntime,
      logStore,
      getCacheStats: () => ({
        size: 0,
        hits: 0,
        misses: 0,
        hitRatio: 0,
        memoryUsage: 0,
      }),
      getBackgroundRunnerState: () => null,
      getAcpTurnIdMigrationSnapshot: getTurnIdMigrationSnapshot,
    });

    await expect(service.execute("user-1")).resolves.toEqual(
      expect.objectContaining({
        sessions: {
          active: 1,
          idle: 0,
          pendingPermissions: 0,
        },
        acp: {
          turnIdPolicy: "compat",
          turnIdMigration: {
            sessionUpdates: {
              native: 0,
              metaFallback: 1,
              missing: 0,
            },
            permissionRequests: {
              native: 1,
              metaFallback: 0,
              missing: 0,
            },
            drops: {
              requireNativePolicy: 0,
              staleTurnMismatch: 1,
              lateAfterTurnCleared: 0,
            },
          },
        },
      })
    );
  });
});
