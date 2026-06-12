import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type SettingsSyncRemoteSnapshot,
  SettingsSyncRemoteSnapshotSchema,
  type SettingsSyncState,
  SettingsSyncStateSchema,
} from "../application/contracts/settings-sync.contract";
import type { SettingsSyncCloudPort } from "../application/ports/settings-sync-cloud.port";
import type { SettingsSyncStateRepositoryPort } from "../application/ports/settings-sync-state-repository.port";

const StateFileSchema = z.object({
  version: z.literal(1),
  states: z.record(z.string(), SettingsSyncStateSchema),
});

const RemoteFileSchema = z.object({
  version: z.literal(1),
  snapshots: z.record(z.string(), SettingsSyncRemoteSnapshotSchema),
});

type StateFile = z.infer<typeof StateFileSchema>;
type RemoteFile = z.infer<typeof RemoteFileSchema>;

interface SettingsSyncFileRepositoryDeps {
  stateFilePath: () => string;
  remoteFilePath: () => string;
}

export class SettingsSyncFileRepository
  implements SettingsSyncStateRepositoryPort, SettingsSyncCloudPort
{
  private readonly stateFilePath: () => string;
  private readonly remoteFilePath: () => string;

  constructor(deps: SettingsSyncFileRepositoryDeps) {
    this.stateFilePath = deps.stateFilePath;
    this.remoteFilePath = deps.remoteFilePath;
  }

  async getState(userId: string): Promise<SettingsSyncState | null> {
    const file = await this.readStateFile();
    return file.states[userId] ?? null;
  }

  async saveState(state: SettingsSyncState): Promise<SettingsSyncState> {
    const file = await this.readStateFile();
    file.states[state.userId] = state;
    await writeJsonFile(this.stateFilePath(), file);
    return state;
  }

  async readRemoteSnapshot(
    userId: string
  ): Promise<SettingsSyncRemoteSnapshot | null> {
    const file = await this.readRemoteFile();
    return file.snapshots[userId] ?? null;
  }

  async writeRemoteSnapshot(
    snapshot: SettingsSyncRemoteSnapshot
  ): Promise<void> {
    const file = await this.readRemoteFile();
    file.snapshots[snapshot.userId] = snapshot;
    await writeJsonFile(this.remoteFilePath(), file);
  }

  private async readStateFile(): Promise<StateFile> {
    return await readJsonFile(this.stateFilePath(), StateFileSchema, {
      version: 1,
      states: {},
    });
  }

  private async readRemoteFile(): Promise<RemoteFile> {
    return await readJsonFile(this.remoteFilePath(), RemoteFileSchema, {
      version: 1,
      snapshots: {},
    });
  }
}

async function readJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  fallback: T
): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      String((error as { code?: unknown }).code) === "ENOENT"
    ) {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
