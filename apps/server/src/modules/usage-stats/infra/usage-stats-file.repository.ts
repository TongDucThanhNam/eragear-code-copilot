import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type UsageStatsRecord,
  UsageStatsRecordSchema,
  type UsageTelemetrySettings,
  UsageTelemetrySettingsSchema,
} from "../application/contracts/usage-stats.contract";
import type { UsageStatsRepositoryPort } from "../application/ports/usage-stats-repository.port";

const DEFAULT_MAX_RECORDS_PER_USER = 5000;

const UsageStatsFileSchema = z.object({
  version: z.literal(1),
  recordsByUserId: z.record(z.string(), z.array(UsageStatsRecordSchema)),
  telemetryByUserId: z.record(z.string(), UsageTelemetrySettingsSchema),
});

type UsageStatsFile = z.infer<typeof UsageStatsFileSchema>;

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

  async getTelemetrySettings(
    userId: string
  ): Promise<UsageTelemetrySettings | null> {
    const file = await this.readFile();
    return file.telemetryByUserId[userId] ?? null;
  }

  async saveTelemetrySettings(
    userId: string,
    settings: UsageTelemetrySettings
  ): Promise<UsageTelemetrySettings> {
    const file = await this.readFile();
    file.telemetryByUserId[userId] = settings;
    await this.writeFile(file);
    return settings;
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
