import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type SettingsSyncRemoteSnapshot,
  SettingsSyncRemoteSnapshotSchema,
  type SettingsSyncState,
  SettingsSyncStateSchema,
} from "../application/contracts/settings-sync.contract";
import type { SettingsSyncCloudPort } from "../application/ports/settings-sync-cloud.port";
import type {
  MutableSettingsSyncStateSnapshot,
  SettingsSyncStateRepositoryPort,
  SettingsSyncStateSnapshot,
} from "../application/ports/settings-sync-state-repository.port";

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

type MutableStateSnapshot = MutableSettingsSyncStateSnapshot & {
  getNext(): SettingsSyncState | null;
  hasChanged(): boolean;
};

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

  async readState<T>(
    userId: string,
    reader: (snapshot: SettingsSyncStateSnapshot) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readStateFile();
    return await reader(createStateSnapshot(file.states[userId] ?? null));
  }

  async mutateState<T>(
    userId: string,
    mutator: (snapshot: MutableSettingsSyncStateSnapshot) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readStateFile();
    const snapshot = createMutableStateSnapshot(file.states[userId] ?? null);
    const result = await mutator(snapshot);
    if (snapshot.hasChanged()) {
      const next = snapshot.getNext();
      if (next) {
        file.states[userId] = next;
        await writeJsonFile(this.stateFilePath(), file);
      }
    }
    return result;
  }

  async readRemoteSnapshot(
    userId: string
  ): Promise<SettingsSyncRemoteSnapshot | null> {
    const file = await this.readRemoteFile();
    const snapshot = file.snapshots[userId] ?? null;
    return snapshot ? cloneJson(snapshot) : null;
  }

  async writeRemoteSnapshot(
    snapshot: SettingsSyncRemoteSnapshot
  ): Promise<void> {
    const file = await this.readRemoteFile();
    file.snapshots[snapshot.userId] = cloneJson(snapshot);
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
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function createStateSnapshot(
  state: SettingsSyncState | null
): SettingsSyncStateSnapshot {
  return {
    get() {
      return state ? cloneJson(state) : null;
    },
  };
}

function createMutableStateSnapshot(
  initial: SettingsSyncState | null
): MutableStateSnapshot {
  let changed = false;
  let next = initial ? cloneJson(initial) : null;
  return {
    get() {
      return next ? cloneJson(next) : null;
    },
    set(state) {
      changed = true;
      next = cloneJson(state);
    },
    getNext() {
      return next ? cloneJson(next) : null;
    },
    hasChanged() {
      return changed;
    },
  };
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}
