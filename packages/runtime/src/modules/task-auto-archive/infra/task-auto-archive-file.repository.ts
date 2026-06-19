import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type TaskAutoArchiveRunResult,
  TaskAutoArchiveRunResultSchema,
  type TaskAutoArchiveSettings,
  TaskAutoArchiveSettingsSchema,
} from "../application/contracts/task-auto-archive.contract";
import type {
  MutableTaskAutoArchiveStoreSnapshot,
  TaskAutoArchiveRepositoryPort,
  TaskAutoArchiveStoreSnapshot,
} from "../application/ports/task-auto-archive-repository.port";

const DOCUMENT_VERSION = 1;

const TaskAutoArchiveFileSchema = z.object({
  version: z.literal(DOCUMENT_VERSION),
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

  async read<T>(
    reader: (snapshot: TaskAutoArchiveStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readFile();
    return await reader(toStoreSnapshot(file));
  }

  async mutate<T>(
    mutator: (snapshot: MutableTaskAutoArchiveStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readFile();
    const snapshot = toMutableStoreSnapshot(file);
    const result = await mutator(snapshot);
    await this.writeFile(fromMutableStoreSnapshot(snapshot));
    return result;
  }

  private async readFile(): Promise<TaskAutoArchiveFile> {
    try {
      const raw = await readFile(this.filePath(), "utf8");
      return TaskAutoArchiveFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isFileNotFound(error)) {
        return {
          version: DOCUMENT_VERSION,
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

function toStoreSnapshot(
  file: TaskAutoArchiveFile
): TaskAutoArchiveStoreSnapshot {
  return {
    settingsByUserId: cloneSettingsByUserId(file.settingsByUserId),
    lastRunByUserId: cloneLastRunsByUserId(file.lastRunByUserId),
  };
}

function toMutableStoreSnapshot(
  file: TaskAutoArchiveFile
): MutableTaskAutoArchiveStoreSnapshot {
  return {
    settingsByUserId: cloneSettingsByUserId(file.settingsByUserId),
    lastRunByUserId: cloneLastRunsByUserId(file.lastRunByUserId),
  };
}

function fromMutableStoreSnapshot(
  snapshot: MutableTaskAutoArchiveStoreSnapshot
): TaskAutoArchiveFile {
  return TaskAutoArchiveFileSchema.parse({
    version: DOCUMENT_VERSION,
    settingsByUserId: cloneSettingsByUserId(snapshot.settingsByUserId),
    lastRunByUserId: cloneLastRunsByUserId(snapshot.lastRunByUserId),
  });
}

function cloneSettingsByUserId(
  settingsByUserId: Readonly<Record<string, TaskAutoArchiveSettings>>
): Record<string, TaskAutoArchiveSettings> {
  return Object.fromEntries(
    Object.entries(settingsByUserId).map(([userId, settings]) => [
      userId,
      { ...settings },
    ])
  );
}

function cloneLastRunsByUserId(
  lastRunByUserId: Readonly<Record<string, TaskAutoArchiveRunResult>>
): Record<string, TaskAutoArchiveRunResult> {
  return Object.fromEntries(
    Object.entries(lastRunByUserId).map(([userId, result]) => [
      userId,
      cloneRunResult(result),
    ])
  );
}

function cloneRunResult(
  result: TaskAutoArchiveRunResult
): TaskAutoArchiveRunResult {
  return {
    ...result,
    userIds: [...result.userIds],
    archivedSessionIds: [...result.archivedSessionIds],
    diagnostics: [...result.diagnostics],
  };
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code?: unknown }).code) === "ENOENT"
  );
}
