/**
 * Get Observability Snapshot Service
 *
 * Builds a runtime observability snapshot from logs, sessions, cache, and background tasks.
 *
 * @module modules/ops/application/get-observability-snapshot.service
 */

import { ENV } from "@/config/environment";
import type { SessionRuntimePort } from "@/modules/session";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { BackgroundRunnerState } from "@/shared/types/background.types";
import type { LogEntry } from "@/shared/types/log.types";

interface AcpTurnIdMigrationCounters {
  native: number;
  metaFallback: number;
  missing: number;
}

interface AcpTurnIdMigrationSnapshot {
  sessionUpdates: AcpTurnIdMigrationCounters;
  permissionRequests: AcpTurnIdMigrationCounters;
  drops: {
    requireNativePolicy: number;
    staleTurnMismatch: number;
    lateAfterTurnCleared: number;
  };
}

interface CacheStatsSnapshot {
  size: number;
  hits: number;
  misses: number;
  hitRatio: number;
  memoryUsage: number;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index] ?? null;
}

function summarizeHttp(entries: LogEntry[], now: number) {
  const httpLogs = entries.filter(
    (entry) => entry.source === "http" && entry.request
  );
  const durations = httpLogs
    .map((entry) => entry.request?.durationMs)
    .filter((value): value is number => typeof value === "number");

  let status2xx = 0;
  let status4xx = 0;
  let status5xx = 0;

  for (const entry of httpLogs) {
    const status = entry.request?.status ?? 0;
    if (status >= 500) {
      status5xx += 1;
      continue;
    }
    if (status >= 400) {
      status4xx += 1;
      continue;
    }
    if (status >= 200) {
      status2xx += 1;
    }
  }

  const oneMinuteAgo = now - 60_000;
  const requestsLastMinute = httpLogs.filter(
    (entry) => entry.timestamp >= oneMinuteAgo
  ).length;

  return {
    total: httpLogs.length,
    requestsPerMinute: requestsLastMinute,
    status2xx,
    status4xx,
    status5xx,
    p50DurationMs: percentile(durations, 50),
    p95DurationMs: percentile(durations, 95),
  };
}

export class GetObservabilitySnapshotService {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly logStore: LogStorePort;
  private readonly getCacheStats: () => CacheStatsSnapshot;
  private readonly getBackgroundRunnerState: () => BackgroundRunnerState | null;
  private readonly getAcpTurnIdMigrationSnapshot: () => AcpTurnIdMigrationSnapshot;

  constructor(params: {
    sessionRuntime: SessionRuntimePort;
    logStore: LogStorePort;
    getCacheStats: () => CacheStatsSnapshot;
    getBackgroundRunnerState: () => BackgroundRunnerState | null;
    getAcpTurnIdMigrationSnapshot: () => AcpTurnIdMigrationSnapshot;
  }) {
    this.sessionRuntime = params.sessionRuntime;
    this.logStore = params.logStore;
    this.getCacheStats = params.getCacheStats;
    this.getBackgroundRunnerState = params.getBackgroundRunnerState;
    this.getAcpTurnIdMigrationSnapshot = params.getAcpTurnIdMigrationSnapshot;
  }

  async execute(userId: string) {
    const now = Date.now();
    const { entries } = await this.logStore.query({
      order: "desc",
      userId,
    });
    const sessions = this.sessionRuntime
      .getAll()
      .filter((session) => session.userId === userId);
    const pendingPermissions = sessions.reduce((acc, session) => {
      return acc + session.pendingPermissions.size;
    }, 0);
    const idleSessions = sessions.filter(
      (session) => session.subscriberCount <= 0
    ).length;

    return {
      ts: now,
      logs: {
        total: entries.length,
        errorCount: entries.filter((entry) => entry.level === "error").length,
        warnCount: entries.filter((entry) => entry.level === "warn").length,
      },
      http: summarizeHttp(entries, now),
      sessions: {
        active: sessions.length,
        idle: idleSessions,
        pendingPermissions,
      },
      cache: this.getCacheStats(),
      background: this.getBackgroundRunnerState(),
      acp: {
        turnIdPolicy: ENV.acpTurnIdPolicy,
        turnIdMigration: this.getAcpTurnIdMigrationSnapshot(),
      },
    };
  }
}
