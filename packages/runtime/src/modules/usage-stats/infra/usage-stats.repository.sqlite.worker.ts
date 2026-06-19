import { callSqliteWorker } from "#runtime/platform/storage/sqlite-worker-client";
import type {
  UsageStatsRecord,
  UsageTelemetrySettings,
} from "../application/contracts/usage-stats.contract";
import type {
  MutableUsageTelemetrySettingsSnapshot,
  UsageStatsRepositoryPort,
  UsageTelemetrySettingsSnapshot,
} from "../application/ports/usage-stats-repository.port";

type MutableTelemetrySettingsSnapshot =
  MutableUsageTelemetrySettingsSnapshot & {
    getNext(): UsageTelemetrySettings | null;
    hasChanged(): boolean;
  };

export class UsageStatsSqliteWorkerRepository
  implements UsageStatsRepositoryPort
{
  appendRecord(record: UsageStatsRecord): Promise<UsageStatsRecord> {
    return callSqliteWorker("usageStats", "appendRecord", [record]);
  }

  listRecords(
    userId: string,
    input?: { sinceMs?: number; limit?: number }
  ): Promise<UsageStatsRecord[]> {
    return callSqliteWorker("usageStats", "listRecords", [userId, input]);
  }

  async readTelemetrySettings<T>(
    userId: string,
    reader: (snapshot: UsageTelemetrySettingsSnapshot) => T | Promise<T>
  ): Promise<T> {
    const settings = await this.getTelemetrySettingsFromWorker(userId);
    return await reader(createTelemetrySettingsSnapshot(settings));
  }

  async mutateTelemetrySettings<T>(
    userId: string,
    mutator: (snapshot: MutableUsageTelemetrySettingsSnapshot) => T | Promise<T>
  ): Promise<T> {
    const current = await this.getTelemetrySettingsFromWorker(userId);
    const snapshot = createMutableTelemetrySettingsSnapshot(current);
    const result = await mutator(snapshot);
    if (snapshot.hasChanged()) {
      const next = snapshot.getNext();
      if (next) {
        await this.saveTelemetrySettingsToWorker(userId, next);
      }
    }
    return result;
  }

  private getTelemetrySettingsFromWorker(
    userId: string
  ): Promise<UsageTelemetrySettings | null> {
    return callSqliteWorker("usageStats", "getTelemetrySettings", [userId]);
  }

  private saveTelemetrySettingsToWorker(
    userId: string,
    settings: UsageTelemetrySettings
  ): Promise<UsageTelemetrySettings> {
    return callSqliteWorker("usageStats", "saveTelemetrySettings", [
      userId,
      settings,
    ]);
  }
}

function createTelemetrySettingsSnapshot(
  settings: UsageTelemetrySettings | null
): UsageTelemetrySettingsSnapshot {
  return {
    get() {
      return settings ? cloneTelemetrySettings(settings) : null;
    },
  };
}

function createMutableTelemetrySettingsSnapshot(
  initial: UsageTelemetrySettings | null
): MutableTelemetrySettingsSnapshot {
  let changed = false;
  let next = initial ? cloneTelemetrySettings(initial) : null;
  return {
    get() {
      return next ? cloneTelemetrySettings(next) : null;
    },
    set(settings) {
      changed = true;
      next = cloneTelemetrySettings(settings);
    },
    getNext() {
      return next ? cloneTelemetrySettings(next) : null;
    },
    hasChanged() {
      return changed;
    },
  };
}

function cloneTelemetrySettings(
  settings: UsageTelemetrySettings
): UsageTelemetrySettings {
  return { ...settings };
}
