import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type UsageStatsRecord,
  UsageStatsRecordSchema,
  type UsageTelemetrySettings,
  UsageTelemetrySettingsSchema,
} from "../application/contracts/usage-stats.contract";
import type {
  MutableUsageTelemetrySettingsSnapshot,
  UsageStatsRepositoryPort,
  UsageTelemetrySettingsSnapshot,
} from "../application/ports/usage-stats-repository.port";

const DEFAULT_MAX_RECORDS_PER_USER = 5000;

const UsageStatsFileSchema = z.object({
  version: z.literal(1),
  recordsByUserId: z.record(z.string(), z.array(UsageStatsRecordSchema)),
  telemetryByUserId: z.record(z.string(), UsageTelemetrySettingsSchema),
});

type UsageStatsFile = z.infer<typeof UsageStatsFileSchema>;
type MutableTelemetrySettingsSnapshot =
  MutableUsageTelemetrySettingsSnapshot & {
    getNext(): UsageTelemetrySettings | null;
  };

export class UsageStatsFileRepository implements UsageStatsRepositoryPort {
  private readonly filePath: () => string;
  private readonly maxRecordsPerUser: number;

  constructor(deps: { filePath: () => string; maxRecordsPerUser?: number }) {
    this.filePath = deps.filePath;
    this.maxRecordsPerUser =
      deps.maxRecordsPerUser ?? DEFAULT_MAX_RECORDS_PER_USER;
  }

  async appendRecord(record: UsageStatsRecord): Promise<UsageStatsRecord> {
    const file = await this.readFile();
    const records = [...(file.recordsByUserId[record.userId] ?? []), record]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, this.maxRecordsPerUser);
    file.recordsByUserId[record.userId] = records;
    await this.writeFile(file);
    return record;
  }

  async listRecords(
    userId: string,
    input?: { sinceMs?: number; limit?: number }
  ): Promise<UsageStatsRecord[]> {
    const file = await this.readFile();
    const records = (file.recordsByUserId[userId] ?? []).filter(
      (record) =>
        input?.sinceMs === undefined || record.createdAt >= input.sinceMs
    );
    return input?.limit === undefined ? records : records.slice(0, input.limit);
  }

  async readTelemetrySettings<T>(
    userId: string,
    reader: (snapshot: UsageTelemetrySettingsSnapshot) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readFile();
    return await reader(
      createTelemetrySettingsSnapshot(file.telemetryByUserId[userId] ?? null)
    );
  }

  async mutateTelemetrySettings<T>(
    userId: string,
    mutator: (snapshot: MutableUsageTelemetrySettingsSnapshot) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readFile();
    const snapshot = createMutableTelemetrySettingsSnapshot(
      file.telemetryByUserId[userId] ?? null
    );
    const result = await mutator(snapshot);
    const next = snapshot.getNext();
    if (next) {
      file.telemetryByUserId[userId] = next;
    }
    await this.writeFile(file);
    return result;
  }

  private async readFile(): Promise<UsageStatsFile> {
    try {
      const raw = await readFile(this.filePath(), "utf8");
      return UsageStatsFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        String((error as { code?: unknown }).code) === "ENOENT"
      ) {
        return {
          version: 1,
          recordsByUserId: {},
          telemetryByUserId: {},
        };
      }
      throw error;
    }
  }

  private async writeFile(file: UsageStatsFile): Promise<void> {
    const target = this.filePath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(file, null, 2)}\n`, "utf8");
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
  let next = initial ? cloneTelemetrySettings(initial) : null;
  return {
    get() {
      return next ? cloneTelemetrySettings(next) : null;
    },
    set(settings) {
      next = cloneTelemetrySettings(settings);
    },
    getNext() {
      return next ? cloneTelemetrySettings(next) : null;
    },
  };
}

function cloneTelemetrySettings(
  settings: UsageTelemetrySettings
): UsageTelemetrySettings {
  return { ...settings };
}
