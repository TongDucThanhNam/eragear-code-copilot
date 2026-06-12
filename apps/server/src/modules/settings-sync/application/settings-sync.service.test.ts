import { describe, expect, test } from "bun:test";
import type {
  SettingsRepositoryPort,
  UpdateSettingsService,
} from "@/modules/settings";
import type { Settings } from "@/shared/types/settings.types";
import type {
  SettingsSyncRemoteSnapshot,
  SettingsSyncState,
} from "./contracts/settings-sync.contract";
import type { SettingsSyncCloudPort } from "./ports/settings-sync-cloud.port";
import type { SettingsSyncStateRepositoryPort } from "./ports/settings-sync-state-repository.port";
import { hashSettings, SettingsSyncService } from "./settings-sync.service";

function createSettings(theme: Settings["ui"]["theme"]): Settings {
  return {
    ui: {
      theme,
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

class SettingsRepoStub implements SettingsRepositoryPort {
  settings = createSettings("dark");

  get(): Promise<Settings> {
    return Promise.resolve(this.settings);
  }

  update(patch: Partial<Settings>): Promise<Settings> {
    this.settings = { ...this.settings, ...patch };
    return Promise.resolve(this.settings);
  }
}

class SettingsUpdaterStub implements Pick<UpdateSettingsService, "execute"> {
  private readonly repo: SettingsRepoStub;

  constructor(repo: SettingsRepoStub) {
    this.repo = repo;
  }

  async execute(patch: Partial<Settings>) {
    const settings = await this.repo.update(patch);
    return { settings, requiresRestart: [], changedKeys: [] };
  }
}

class StateRepoStub implements SettingsSyncStateRepositoryPort {
  state: SettingsSyncState | null = null;

  getState(_userId: string): Promise<SettingsSyncState | null> {
    return Promise.resolve(this.state);
  }

  saveState(state: SettingsSyncState): Promise<SettingsSyncState> {
    this.state = state;
    return Promise.resolve(state);
  }
}

class CloudStub implements SettingsSyncCloudPort {
  snapshot: SettingsSyncRemoteSnapshot | null = null;

  readRemoteSnapshot(
    _userId: string
  ): Promise<SettingsSyncRemoteSnapshot | null> {
    return Promise.resolve(this.snapshot);
  }

  writeRemoteSnapshot(snapshot: SettingsSyncRemoteSnapshot): Promise<void> {
    this.snapshot = snapshot;
    return Promise.resolve();
  }
}

describe("SettingsSyncService", () => {
  test("pushes local settings when no remote snapshot exists", async () => {
    const settingsRepo = new SettingsRepoStub();
    const stateRepo = new StateRepoStub();
    const cloud = new CloudStub();
    const service = new SettingsSyncService({
      settingsRepo,
      settingsUpdater: new SettingsUpdaterStub(settingsRepo),
      stateRepo,
      cloud,
      now: () => 10,
      createId: () => "id",
    });

    const result = await service.syncNow("user-1");

    expect(result.action).toBe("pushed");
    expect(cloud.snapshot?.settingsHash).toBe(
      hashSettings(settingsRepo.settings)
    );
    expect(result.status.state.lastPushAt).toBe(10);
  });

  test("detects first-sync conflicts when remote already has different settings", async () => {
    const settingsRepo = new SettingsRepoStub();
    const cloud = new CloudStub();
    cloud.snapshot = {
      version: 1,
      userId: "user-1",
      revision: "remote-1",
      updatedAt: 5,
      deviceId: "remote-device",
      settings: createSettings("light"),
      settingsHash: hashSettings(createSettings("light")),
    };
    const service = new SettingsSyncService({
      settingsRepo,
      settingsUpdater: new SettingsUpdaterStub(settingsRepo),
      stateRepo: new StateRepoStub(),
      cloud,
      now: () => 10,
      createId: () => "local-device",
    });

    const result = await service.syncNow("user-1");

    expect(result.action).toBe("conflict");
    expect(result.status.state.pendingConflict?.reason).toBe(
      "first_sync_remote_exists"
    );
  });

  test("pull strategy applies the remote snapshot through the settings updater", async () => {
    const settingsRepo = new SettingsRepoStub();
    const cloud = new CloudStub();
    cloud.snapshot = {
      version: 1,
      userId: "user-1",
      revision: "remote-1",
      updatedAt: 5,
      deviceId: "remote-device",
      settings: createSettings("light"),
      settingsHash: hashSettings(createSettings("light")),
    };
    const service = new SettingsSyncService({
      settingsRepo,
      settingsUpdater: new SettingsUpdaterStub(settingsRepo),
      stateRepo: new StateRepoStub(),
      cloud,
      now: () => 10,
      createId: () => "local-device",
    });

    const result = await service.syncNow("user-1", { strategy: "pull" });

    expect(result.action).toBe("pulled");
    expect(settingsRepo.settings.ui.theme).toBe("light");
    expect(result.status.state.pendingConflict).toBeNull();
  });
});
