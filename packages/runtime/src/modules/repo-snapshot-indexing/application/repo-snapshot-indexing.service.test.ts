import { describe, expect, test } from "bun:test";
import type {
  RefreshRepoSnapshotIndexInput,
  RepoSnapshotIndexData,
  RepoSnapshotIndexingProjectInput,
  RepoSnapshotIndexingSettings,
  RepoSnapshotIndexSearchResult,
  RepoSnapshotIndexSnapshot,
  RepoSnapshotStorageState,
  SearchRepoSnapshotIndexInput,
} from "./contracts/repo-snapshot-indexing.contract";
import type { RepoSnapshotIndexPort } from "./ports/repo-snapshot-index.port";
import type {
  MutableRepoSnapshotIndexingSettingsSnapshot,
  RepoSnapshotIndexingRepositoryPort,
  RepoSnapshotIndexingSettingsScope,
  RepoSnapshotIndexingSettingsSnapshot,
} from "./ports/repo-snapshot-indexing-repository.port";
import { extractRepoIndexSymbolFromLine } from "./repo-index-symbol-extraction";
import { RepoSnapshotIndexingService } from "./repo-snapshot-indexing.service";

class RepoIndexPortStub implements RepoSnapshotIndexPort {
  refreshCount = 0;
  private data: RepoSnapshotIndexData;

  constructor(data: RepoSnapshotIndexData) {
    this.data = data;
  }

  getIndexSnapshot(
    _userId: string,
    _input?: RepoSnapshotIndexingProjectInput
  ): Promise<RepoSnapshotIndexData> {
    return Promise.resolve(this.data);
  }

  refreshIndex(
    _userId: string,
    _input?: RefreshRepoSnapshotIndexInput
  ): Promise<RepoSnapshotIndexData> {
    this.refreshCount += 1;
    this.data = {
      ...this.data,
      index: {
        ...this.data.index,
        indexedAt: "2026-06-12T00:00:00.000Z",
        indexedFiles: 1,
        totalBytes: 42,
        files: [
          {
            path: "src/index.ts",
            sizeBytes: 42,
            extension: ".ts",
            language: "typescript",
          },
        ],
        symbols: [
          {
            path: "src/index.ts",
            name: "main",
            kind: "function",
            line: 1,
            language: "typescript",
          },
        ],
      },
    };
    return Promise.resolve(this.data);
  }

  searchIndex(
    _userId: string,
    input: SearchRepoSnapshotIndexInput
  ): Promise<RepoSnapshotIndexSearchResult> {
    return Promise.resolve({
      status: "ready",
      query: input.query,
      indexedAt: this.data.index.indexedAt,
      results: [
        {
          type: "file",
          path: "src/index.ts",
          title: "src/index.ts",
          detail: "typescript",
          score: 1,
          matchKind: "direct",
        },
      ],
      prompt: "Use src/index.ts",
      diagnostics: [],
    });
  }
}

class RepoSnapshotRepositoryStub implements RepoSnapshotIndexingRepositoryPort {
  manifestWrites = 0;
  private readonly settingsByScope = new Map<
    string,
    RepoSnapshotIndexingSettings
  >();
  private state: RepoSnapshotStorageState;

  constructor(settings: RepoSnapshotIndexingSettings | null = null) {
    if (settings) {
      this.settingsByScope.set(
        settingsScopeKey({ userId: "user-1", projectRoot: "/repo" }),
        settings
      );
    }
    this.state = createStorageState([]);
  }

  readSettings<T>(
    reader: (snapshot: RepoSnapshotIndexingSettingsSnapshot) => T | Promise<T>
  ): Promise<T> {
    return Promise.resolve(reader(this.createSettingsSnapshot()));
  }

  mutateSettings<T>(
    mutator: (
      snapshot: MutableRepoSnapshotIndexingSettingsSnapshot
    ) => T | Promise<T>
  ): Promise<T> {
    return Promise.resolve(mutator(this.createMutableSettingsSnapshot()));
  }

  getStorageState(): Promise<RepoSnapshotStorageState> {
    return Promise.resolve(this.state);
  }

  writeManifest(input: {
    projectRoot: string;
    index: RepoSnapshotIndexSnapshot;
    reason: string;
    createdAt: string;
  }): Promise<{
    manifest: never;
    state: RepoSnapshotStorageState;
  }> {
    this.manifestWrites += 1;
    this.state = createStorageState([
      {
        id: "manifest-1",
        manifestPath: "/repo/.eragear/repo-snapshots/manifests/manifest-1.json",
        createdAt: input.createdAt,
        reason: input.reason,
        indexedAt: input.index.indexedAt,
        indexedFiles: input.index.indexedFiles,
        totalBytes: input.index.totalBytes,
        symbolCount: input.index.symbols.length,
        taskCount: input.index.tasks.length,
        semanticStatus: input.index.semantic.status,
        hash: "sha256:manifest",
      },
    ]);
    return Promise.resolve({
      manifest: undefined as never,
      state: this.state,
    });
  }

  getStoredSettings(
    scope: RepoSnapshotIndexingSettingsScope
  ): RepoSnapshotIndexingSettings | null {
    return this.settingsByScope.get(settingsScopeKey(scope)) ?? null;
  }

  private createSettingsSnapshot(): RepoSnapshotIndexingSettingsSnapshot {
    return {
      get: (scope) => this.getStoredSettings(scope),
    };
  }

  private createMutableSettingsSnapshot(): MutableRepoSnapshotIndexingSettingsSnapshot {
    return {
      ...this.createSettingsSnapshot(),
      set: (scope, settings) => {
        this.settingsByScope.set(settingsScopeKey(scope), settings);
      },
    };
  }
}

function createIndexData(): RepoSnapshotIndexData {
  return {
    projectRoot: "/repo",
    index: {
      storagePath: "/repo/.eragear/repo-index.json",
      indexedFiles: 0,
      totalBytes: 0,
      semantic: {
        status: "empty",
        profiledFiles: 0,
        tokenCount: 0,
        source: "local-token-profile",
      },
      extensions: [],
      files: [],
      symbols: [],
      tasks: [],
      diagnostics: ["Project index has not been refreshed yet."],
    },
  };
}

function settingsScopeKey(scope: RepoSnapshotIndexingSettingsScope): string {
  return `${scope.userId}:${scope.projectRoot}`;
}

function createStorageState(
  manifests: RepoSnapshotStorageState["manifests"]
): RepoSnapshotStorageState {
  return {
    projectRoot: "/repo",
    statePath: "/repo/.eragear/repo-snapshots/state.json",
    manifestDir: "/repo/.eragear/repo-snapshots/manifests",
    lastAcceptedManifestPath: manifests[0]?.manifestPath,
    manifests,
    diagnostics:
      manifests.length === 0
        ? ["No repo snapshot manifests have been written yet."]
        : [],
  };
}

describe("RepoSnapshotIndexingService", () => {
  test("enabling indexing refreshes and writes a manifest", async () => {
    const index = new RepoIndexPortStub(createIndexData());
    const repository = new RepoSnapshotRepositoryStub({
      enabled: false,
      userConfigured: true,
      updatedAt: "2026-06-11T00:00:00.000Z",
    });
    const service = new RepoSnapshotIndexingService({
      index,
      repository,
      now: () => "2026-06-12T00:00:00.000Z",
    });

    const result = await service.updateSettings("user-1", {
      enabled: true,
    });

    expect(index.refreshCount).toBe(1);
    expect(repository.manifestWrites).toBe(1);
    expect(result.settings.enabled).toBe(true);
    expect(
      repository.getStoredSettings({
        userId: "user-1",
        projectRoot: "/repo",
      })?.lastRefreshAt
    ).toBe("2026-06-12T00:00:00.000Z");
    expect(result.index.indexedFiles).toBe(1);
    expect(result.storage.manifests).toHaveLength(1);
  });

  test("search returns disabled status when indexing is off", async () => {
    const service = new RepoSnapshotIndexingService({
      index: new RepoIndexPortStub(createIndexData()),
      repository: new RepoSnapshotRepositoryStub({
        enabled: false,
        userConfigured: true,
        updatedAt: "2026-06-12T00:00:00.000Z",
      }),
      now: () => "2026-06-12T00:00:00.000Z",
    });

    const result = await service.search("user-1", {
      query: "main",
    });

    expect(result.status).toBe("disabled");
    expect(result.results).toEqual([]);
    expect(result.diagnostics[0]).toContain("disabled");
  });

  test("extracts typed TSX component declarations for resolver signals", () => {
    const symbol = extractRepoIndexSymbolFromLine({
      line: "export const HomePage: FC<Props> = () => null",
      extension: ".tsx",
    });

    expect(symbol).toEqual({ kind: "component", name: "HomePage" });
  });
});
