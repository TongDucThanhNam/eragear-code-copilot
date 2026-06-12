import type {
  RefreshRepoSnapshotIndexInput,
  RepoSnapshotIndexData,
  RepoSnapshotIndexingProjectInput,
  RepoSnapshotIndexingSettings,
  RepoSnapshotIndexOverview,
  RepoSnapshotIndexSearchResult,
  SearchRepoSnapshotIndexInput,
  UpdateRepoSnapshotIndexingSettingsInput,
} from "./contracts/repo-snapshot-indexing.contract";
import type { RepoSnapshotIndexPort } from "./ports/repo-snapshot-index.port";
import type { RepoSnapshotIndexingRepositoryPort } from "./ports/repo-snapshot-indexing-repository.port";

export class RepoSnapshotIndexingService {
  private readonly index: RepoSnapshotIndexPort;
  private readonly repository: RepoSnapshotIndexingRepositoryPort;
  private readonly now: () => string;

  constructor(deps: {
    index: RepoSnapshotIndexPort;
    repository: RepoSnapshotIndexingRepositoryPort;
    now?: () => string;
  }) {
    this.index = deps.index;
    this.repository = deps.repository;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async getOverview(
    userId: string,
    input?: RepoSnapshotIndexingProjectInput
  ): Promise<RepoSnapshotIndexOverview> {
    const data = await this.index.getIndexSnapshot(userId, input);
    const settings = await this.resolveSettings(userId, data.projectRoot);
    const storage = await this.repository.getStorageState(data.projectRoot);
    return toOverview({ data, settings, storage });
  }

  async updateSettings(
    userId: string,
    input: UpdateRepoSnapshotIndexingSettingsInput
  ): Promise<RepoSnapshotIndexOverview> {
    const data = await this.index.getIndexSnapshot(userId, input);
    const current = await this.resolveSettings(userId, data.projectRoot);
    const next: RepoSnapshotIndexingSettings = {
      ...current,
      enabled: input.enabled,
      userConfigured: true,
      updatedAt: this.now(),
    };

    await this.repository.saveSettings(userId, data.projectRoot, next);

    if (next.enabled && (input.refreshNow ?? !current.enabled)) {
      return await this.refresh(userId, {
        projectId: input.projectId,
        reason: "enable-setting",
      });
    }

    const storage = await this.repository.getStorageState(data.projectRoot);
    return toOverview({ data, settings: next, storage });
  }

  async refresh(
    userId: string,
    input: RefreshRepoSnapshotIndexInput = {}
  ): Promise<RepoSnapshotIndexOverview> {
    const currentData = await this.index.getIndexSnapshot(userId, input);
    const settings = await this.resolveSettings(
      userId,
      currentData.projectRoot
    );
    if (!settings.enabled) {
      const storage = await this.repository.getStorageState(
        currentData.projectRoot
      );
      return toOverview({
        data: currentData,
        settings,
        storage,
        diagnostics: ["Repo snapshot indexing is disabled for this project."],
      });
    }

    const refreshedData = await this.index.refreshIndex(userId, input);
    const createdAt = this.now();
    const updatedSettings: RepoSnapshotIndexingSettings = {
      ...settings,
      lastRefreshAt: createdAt,
      updatedAt: settings.updatedAt || createdAt,
    };
    await this.repository.saveSettings(
      userId,
      refreshedData.projectRoot,
      updatedSettings
    );
    const { state } = await this.repository.writeManifest({
      projectRoot: refreshedData.projectRoot,
      index: refreshedData.index,
      reason: input?.reason?.trim() || "manual-refresh",
      createdAt,
    });

    return toOverview({
      data: refreshedData,
      settings: updatedSettings,
      storage: state,
    });
  }

  async search(
    userId: string,
    input: SearchRepoSnapshotIndexInput
  ): Promise<RepoSnapshotIndexSearchResult> {
    const data = await this.index.getIndexSnapshot(userId, input);
    const settings = await this.resolveSettings(userId, data.projectRoot);
    if (!settings.enabled) {
      return {
        status: "disabled",
        query: input.query,
        indexedAt: data.index.indexedAt,
        results: [],
        prompt: "",
        diagnostics: ["Repo snapshot indexing is disabled for this project."],
      };
    }
    return await this.index.searchIndex(userId, input);
  }

  private async resolveSettings(
    userId: string,
    projectRoot: string
  ): Promise<RepoSnapshotIndexingSettings> {
    const existing = await this.repository.getSettings(userId, projectRoot);
    if (existing) {
      return existing;
    }
    return {
      enabled: true,
      userConfigured: false,
      updatedAt: this.now(),
    };
  }
}

function toOverview(input: {
  data: RepoSnapshotIndexData;
  settings: RepoSnapshotIndexingSettings;
  storage: RepoSnapshotIndexOverview["storage"];
  diagnostics?: string[];
}): RepoSnapshotIndexOverview {
  const status = resolveOverviewStatus(input);
  return {
    projectRoot: input.data.projectRoot,
    settings: input.settings,
    index: input.data.index,
    storage: input.storage,
    status,
    diagnostics: [
      ...input.data.index.diagnostics,
      ...input.storage.diagnostics,
      ...(input.diagnostics ?? []),
    ],
  };
}

function resolveOverviewStatus(input: {
  data: RepoSnapshotIndexData;
  settings: RepoSnapshotIndexingSettings;
}): RepoSnapshotIndexOverview["status"] {
  if (!input.settings.enabled) {
    return "disabled";
  }
  if (!input.data.index.indexedAt) {
    return "not-indexed";
  }
  return "enabled";
}
