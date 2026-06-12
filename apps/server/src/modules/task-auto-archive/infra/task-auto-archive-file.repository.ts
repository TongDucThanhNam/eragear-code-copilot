import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type TaskAutoArchiveRunResult,
  TaskAutoArchiveRunResultSchema,
  type TaskAutoArchiveSettings,
  TaskAutoArchiveSettingsSchema,
} from "../application/contracts/task-auto-archive.contract";
import type { TaskAutoArchiveRepositoryPort } from "../application/ports/task-auto-archive-repository.port";

const TaskAutoArchiveFileSchema = z.object({
  version: z.literal(1),
  settingsByUserId: z.record(z.string(), TaskAutoArchiveSettingsSchema),
  lastRunByUserId: z.record(z.string(), TaskAutoArchiveRunResultSchema),
});

type TaskAutoArchiveFile = z.infer<typeof TaskAutoArchiveFileSchema>;

export class TaskAutoArchiveFileRepository
  implements TaskAutoArchiveRepositoryPort
{
  private readonly filePath: () => string;

  constructor(deps: { filePath: () => string }) {
    this.filePath = deps.filePath;
  }

  async getSettings(userId: string): Promise<TaskAutoArchiveSettings | null> {
    const file = await this.readFile();
    return file.settingsByUserId[userId] ?? null;
  }

  async saveSettings(
    userId: string,
    settings: TaskAutoArchiveSettings
  ): Promise<TaskAutoArchiveSettings> {
    const file = await this.readFile();
    file.settingsByUserId[userId] = settings;
    await this.writeFile(file);
    return settings;
  }

  async getLastRun(userId: string): Promise<TaskAutoArchiveRunResult | null> {
    const file = await this.readFile();
    return file.lastRunByUserId[userId] ?? null;
  }

  async saveLastRun(
    userId: string,
    result: TaskAutoArchiveRunResult
  ): Promise<void> {
    const file = await this.readFile();
    file.lastRunByUserId[userId] = result;
    await this.writeFile(file);
  }

  private async readFile(): Promise<TaskAutoArchiveFile> {
    try {
      const raw = await readFile(this.filePath(), "utf8");
      return TaskAutoArchiveFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isFileNotFound(error)) {
        return {
          version: 1,
          settingsByUserId: {},
          lastRunByUserId: {},
        };
      }
      throw error;
    }
  }

  private async writeFile(file: TaskAutoArchiveFile): Promise<void> {
    const target = this.filePath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code?: unknown }).code) === "ENOENT"
  );
}
