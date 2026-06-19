import { createHash, randomUUID } from "node:crypto";
import type {
  SettingsRepositoryPort,
  UpdateSettingsService,
} from "#runtime/modules/settings";
import type { Settings } from "#runtime/shared/types/settings.types";
import type {
  SettingsSyncConflict,
  SettingsSyncNowInput,
  SettingsSyncRemoteSnapshot,
  SettingsSyncResult,
  SettingsSyncState,
  SettingsSyncStatus,
  UpdateSettingsSyncConfigInput,
} from "./contracts/settings-sync.contract";
import type { SettingsSyncCloudPort } from "./ports/settings-sync-cloud.port";
import type {
  SettingsSyncStateRepositoryPort,
  SettingsSyncStateSnapshot,
} from "./ports/settings-sync-state-repository.port";

interface SettingsSyncServiceDeps {
  settingsRepo: SettingsRepositoryPort;
  settingsUpdater: Pick<UpdateSettingsService, "execute">;
  stateRepo: SettingsSyncStateRepositoryPort;
  cloud: SettingsSyncCloudPort;
  now?: () => number;
  createId?: () => string;
}

export class SettingsSyncService {
  private readonly settingsRepo: SettingsRepositoryPort;
  private readonly settingsUpdater: Pick<UpdateSettingsService, "execute">;
  private readonly stateRepo: SettingsSyncStateRepositoryPort;
  private readonly cloud: SettingsSyncCloudPort;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(deps: SettingsSyncServiceDeps) {
    this.settingsRepo = deps.settingsRepo;
    this.settingsUpdater = deps.settingsUpdater;
    this.stateRepo = deps.stateRepo;
    this.cloud = deps.cloud;
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? randomUUID;
  }

  async getStatus(userId: string): Promise<SettingsSyncStatus> {
    const state = await this.getOrCreateState(userId);
    return await this.buildStatus(userId, state);
  }

  async updateConfig(
    userId: string,
    input: UpdateSettingsSyncConfigInput
  ): Promise<SettingsSyncStatus> {
    const next = await this.updateState(userId, (state) => ({
      ...state,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.firstRunPromptHandled !== undefined
        ? { firstRunPromptHandled: input.firstRunPromptHandled }
        : {}),
    }));
    return await this.buildStatus(userId, next);
  }

  async markFirstRunPromptHandled(userId: string): Promise<SettingsSyncStatus> {
    return await this.updateConfig(userId, { firstRunPromptHandled: true });
  }

  async syncNow(
    userId: string,
    input?: SettingsSyncNowInput
  ): Promise<SettingsSyncResult> {
    const strategy = input?.strategy ?? "auto";
    const state = await this.getOrCreateState(userId);
    const localSettings = await this.settingsRepo.get();
    const localHash = hashSettings(localSettings);
    const remote = await this.cloud.readRemoteSnapshot(userId);

    if (strategy === "push" || !remote) {
      return await this.pushLocal(userId, state, localSettings, localHash);
    }

    if (strategy === "pull") {
      return await this.pullRemote(userId, state, remote);
    }

    if (remote.settingsHash === localHash) {
      const synced = await this.replaceState(userId, {
        ...state,
        lastSyncAt: this.now(),
        lastSyncedSettingsHash: localHash,
        lastRemoteRevision: remote.revision,
        pendingConflict: null,
      });
      return { action: "noop", status: await this.buildStatus(userId, synced) };
    }

    const remoteChanged =
      state.lastRemoteRevision !== null &&
      remote.revision !== state.lastRemoteRevision;
    const localChanged =
      state.lastSyncedSettingsHash !== null &&
      localHash !== state.lastSyncedSettingsHash;
    const firstSyncRemoteExists = state.lastSyncedSettingsHash === null;

    if ((remoteChanged && localChanged) || firstSyncRemoteExists) {
      const conflict = this.createConflict({
        reason: firstSyncRemoteExists
          ? "first_sync_remote_exists"
          : "both_changed",
        localHash,
        remote,
      });
      const conflicted = await this.replaceState(userId, {
        ...state,
        pendingConflict: conflict,
      });
      return {
        action: "conflict",
        status: await this.buildStatus(userId, conflicted),
      };
    }

    if (remoteChanged) {
      return await this.pullRemote(userId, state, remote);
    }

    return await this.pushLocal(userId, state, localSettings, localHash);
  }

  private async pushLocal(
    userId: string,
    state: SettingsSyncState,
    settings: Settings,
    settingsHash: string
  ): Promise<SettingsSyncResult> {
    const now = this.now();
    const snapshot: SettingsSyncRemoteSnapshot = {
      version: 1,
      userId,
      revision: `${now}-${this.createId()}`,
      updatedAt: now,
      deviceId: state.deviceId,
      settingsHash,
      settings,
    };
    await this.cloud.writeRemoteSnapshot(snapshot);
    const next = await this.replaceState(userId, {
      ...state,
      lastSyncAt: now,
      lastPushAt: now,
      lastSyncedSettingsHash: settingsHash,
      lastRemoteRevision: snapshot.revision,
      pendingConflict: null,
    });
    return { action: "pushed", status: await this.buildStatus(userId, next) };
  }

  private async pullRemote(
    userId: string,
    state: SettingsSyncState,
    remote: SettingsSyncRemoteSnapshot
  ): Promise<SettingsSyncResult> {
    const update = await this.settingsUpdater.execute(remote.settings);
    const pulledHash = hashSettings(update.settings);
    const now = this.now();
    const next = await this.replaceState(userId, {
      ...state,
      lastSyncAt: now,
      lastPullAt: now,
      lastSyncedSettingsHash: pulledHash,
      lastRemoteRevision: remote.revision,
      pendingConflict: null,
    });
    return { action: "pulled", status: await this.buildStatus(userId, next) };
  }

  private createConflict(input: {
    reason: SettingsSyncConflict["reason"];
    localHash: string;
    remote: SettingsSyncRemoteSnapshot;
  }): SettingsSyncConflict {
    return {
      detectedAt: this.now(),
      reason: input.reason,
      localHash: input.localHash,
      remoteHash: input.remote.settingsHash,
      remoteRevision: input.remote.revision,
      remoteUpdatedAt: input.remote.updatedAt,
    };
  }

  private async buildStatus(
    userId: string,
    state: SettingsSyncState
  ): Promise<SettingsSyncStatus> {
    const [settings, remote] = await Promise.all([
      this.settingsRepo.get(),
      this.cloud.readRemoteSnapshot(userId),
    ]);
    return {
      state,
      localSettingsHash: hashSettings(settings),
      remote: {
        available: Boolean(remote),
        revision: remote?.revision ?? null,
        updatedAt: remote?.updatedAt ?? null,
        deviceId: remote?.deviceId ?? null,
        settingsHash: remote?.settingsHash ?? null,
      },
    };
  }

  private async getOrCreateState(userId: string): Promise<SettingsSyncState> {
    return await this.stateRepo.mutateState(userId, (snapshot) => {
      const existing = snapshot.get();
      if (existing) {
        return existing;
      }
      const initial = this.createInitialState(userId);
      snapshot.set(initial);
      return initial;
    });
  }

  private async updateState(
    userId: string,
    updater: (state: SettingsSyncState) => SettingsSyncState
  ): Promise<SettingsSyncState> {
    return await this.stateRepo.mutateState(userId, (snapshot) => {
      const next = updater(this.resolveState(userId, snapshot));
      snapshot.set(next);
      return next;
    });
  }

  private async replaceState(
    userId: string,
    state: SettingsSyncState
  ): Promise<SettingsSyncState> {
    return await this.stateRepo.mutateState(userId, (snapshot) => {
      snapshot.set(state);
      return state;
    });
  }

  private resolveState(
    userId: string,
    snapshot: SettingsSyncStateSnapshot
  ): SettingsSyncState {
    return snapshot.get() ?? this.createInitialState(userId);
  }

  private createInitialState(userId: string): SettingsSyncState {
    return {
      userId,
      enabled: false,
      firstRunPromptHandled: false,
      deviceId: this.createId(),
      lastSyncAt: null,
      lastPushAt: null,
      lastPullAt: null,
      lastSyncedSettingsHash: null,
      lastRemoteRevision: null,
      pendingConflict: null,
    };
  }
}

export function hashSettings(settings: Settings): string {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(settings)))
    .digest("hex");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)])
    );
  }
  return value;
}
