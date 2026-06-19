import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Settings } from "#runtime/shared/types/settings.types";
import type {
  SettingsSyncRemoteSnapshot,
  SettingsSyncState,
} from "../application/contracts/settings-sync.contract";
import { SettingsSyncFileRepository } from "./settings-sync-file.repository";

describe("SettingsSyncFileRepository", () => {
  it("persists user state through the state snapshot seam", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "settings-sync-"));
    const stateFilePath = path.join(root, "settings-sync-state.json");
    const repository = createRepository(root);

    try {
      const state = createState({ enabled: true });

      await repository.mutateState("user-1", (snapshot) => {
        snapshot.set(state);
      });

      const loaded = await repository.readState("user-1", (snapshot) =>
        snapshot.get()
      );
      expect(loaded).toEqual(state);

      if (loaded) {
        loaded.enabled = false;
      }

      await expect(
        repository.readState("user-1", (snapshot) => snapshot.get())
      ).resolves.toEqual(state);
      await expect(readPersistedVersion(stateFilePath)).resolves.toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("clones remote snapshots before exposing them", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "settings-sync-"));
    const repository = createRepository(root);

    try {
      const remote = createRemoteSnapshot();

      await repository.writeRemoteSnapshot(remote);
      const loaded = await repository.readRemoteSnapshot("user-1");

      expect(loaded).toEqual(remote);
      if (loaded) {
        loaded.settings.ui.theme = "light";
      }

      await expect(repository.readRemoteSnapshot("user-1")).resolves.toEqual(
        remote
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function createRepository(root: string): SettingsSyncFileRepository {
  return new SettingsSyncFileRepository({
    stateFilePath: () => path.join(root, "settings-sync-state.json"),
    remoteFilePath: () => path.join(root, "settings-sync-cloud.json"),
  });
}

function createState(
  overrides: Partial<SettingsSyncState> = {}
): SettingsSyncState {
  return {
    userId: "user-1",
    enabled: false,
    firstRunPromptHandled: false,
    deviceId: "device-1",
    lastSyncAt: null,
    lastPushAt: null,
    lastPullAt: null,
    lastSyncedSettingsHash: null,
    lastRemoteRevision: null,
    pendingConflict: null,
    ...overrides,
  };
}

function createRemoteSnapshot(): SettingsSyncRemoteSnapshot {
  return {
    version: 1,
    userId: "user-1",
    revision: "remote-1",
    updatedAt: 10,
    deviceId: "device-1",
    settingsHash: "hash-1",
    settings: createSettings(),
  };
}

function createSettings(): Settings {
  return {
    ui: {
      theme: "dark",
      accentColor: "#2563eb",
      density: "comfortable",
      fontScale: 1,
    },
    projectRoots: ["C:/repo"],
    mcpServers: [],
    app: {
      sessionIdleTimeoutMs: 60_000,
      sessionListPageMaxLimit: 50,
      sessionMessagesPageMaxLimit: 100,
      logLevel: "info",
      maxTokens: 4096,
      defaultModel: "auto",
      acpPromptMetaPolicy: "allowlist",
      acpPromptMetaAllowlist: [],
    },
  };
}

async function readPersistedVersion(filePath: string): Promise<number> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as { version?: number };
  return parsed.version ?? 0;
}
