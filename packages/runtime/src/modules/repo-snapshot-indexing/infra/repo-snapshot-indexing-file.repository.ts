import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type RepoSnapshotIndexingSettings,
  RepoSnapshotIndexingSettingsSchema,
  type RepoSnapshotIndexSnapshot,
  type RepoSnapshotManifest,
  RepoSnapshotManifestSchema,
  type RepoSnapshotManifestSummary,
  type RepoSnapshotStorageState,
  RepoSnapshotStorageStateSchema,
} from "../application/contracts/repo-snapshot-indexing.contract";
import type {
  MutableRepoSnapshotIndexingSettingsSnapshot,
  RepoSnapshotIndexingRepositoryPort,
  RepoSnapshotIndexingSettingsScope,
  RepoSnapshotIndexingSettingsSnapshot,
} from "../application/ports/repo-snapshot-indexing-repository.port";

const MAX_MANIFESTS_PER_PROJECT = 20;
const MAX_MANIFEST_FILE_SAMPLE = 200;
const MAX_MANIFEST_SYMBOL_SAMPLE = 200;
const MAX_MANIFEST_TASK_SAMPLE = 200;

const RepoSnapshotIndexingFileSchema = z.object({
  version: z.literal(1),
  settingsByUserProject: z.record(
    z.string(),
    RepoSnapshotIndexingSettingsSchema
  ),
});

const RepoSnapshotProjectStateFileSchema = z.object({
  version: z.literal(1),
  projectRoot: z.string().min(1),
  lastAcceptedManifestPath: z.string().optional(),
  manifests: z.array(RepoSnapshotManifestSchema),
});

type RepoSnapshotIndexingFile = z.infer<typeof RepoSnapshotIndexingFileSchema>;
type SettingsByUserProject = Record<string, RepoSnapshotIndexingSettings>;

export class RepoSnapshotIndexingFileRepository
  implements RepoSnapshotIndexingRepositoryPort
{
  private readonly filePath: () => string;

  constructor(deps: { filePath: () => string }) {
    this.filePath = deps.filePath;
  }

  async readSettings<T>(
    reader: (snapshot: RepoSnapshotIndexingSettingsSnapshot) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readSettingsFile();
    return await reader(createSettingsSnapshot(file.settingsByUserProject));
  }

  async mutateSettings<T>(
    mutator: (
      snapshot: MutableRepoSnapshotIndexingSettingsSnapshot
    ) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readSettingsFile();
    const settingsByUserProject = cloneSettingsByUserProject(
      file.settingsByUserProject
    );
    const result = await mutator(
      createMutableSettingsSnapshot(settingsByUserProject)
    );
    await this.writeSettingsFile({
      version: 1,
      settingsByUserProject,
    });
    return result;
  }

  async getStorageState(
    projectRoot: string
  ): Promise<RepoSnapshotStorageState> {
    const stateFile = await this.readProjectStateFile(projectRoot);
    return toStorageState(projectRoot, stateFile);
  }

  async writeManifest(input: {
    projectRoot: string;
    index: RepoSnapshotIndexSnapshot;
    reason: string;
    createdAt: string;
  }): Promise<{
    manifest: RepoSnapshotManifest;
    state: RepoSnapshotStorageState;
  }> {
    const manifest = createManifest(input);
    const paths = projectSnapshotPaths(input.projectRoot);
    const manifestPath = path.join(paths.manifestDir, `${manifest.id}.json`);
    const persistedManifest: RepoSnapshotManifest = {
      ...manifest,
      manifestPath,
    };

    await mkdir(paths.manifestDir, { recursive: true });
    await writeJsonFile(manifestPath, persistedManifest);

    const current = await this.readProjectStateFile(input.projectRoot);
    const manifests = [
      persistedManifest,
      ...current.manifests.filter((item) => item.id !== persistedManifest.id),
    ].slice(0, MAX_MANIFESTS_PER_PROJECT);
    const nextState = {
      version: 1 as const,
      projectRoot: input.projectRoot,
      lastAcceptedManifestPath: manifestPath,
      manifests,
    };
    await writeJsonFile(paths.statePath, nextState);

    return {
      manifest: persistedManifest,
      state: toStorageState(input.projectRoot, nextState),
    };
  }

  private async readSettingsFile(): Promise<RepoSnapshotIndexingFile> {
    try {
      const raw = await readFile(this.filePath(), "utf8");
      return RepoSnapshotIndexingFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isFileNotFound(error)) {
        return {
          version: 1,
          settingsByUserProject: {},
        };
      }
      throw error;
    }
  }

  private async writeSettingsFile(
    file: RepoSnapshotIndexingFile
  ): Promise<void> {
    await writeJsonFile(this.filePath(), file);
  }

  private async readProjectStateFile(projectRoot: string): Promise<{
    version: 1;
    projectRoot: string;
    lastAcceptedManifestPath?: string;
    manifests: RepoSnapshotManifest[];
  }> {
    const paths = projectSnapshotPaths(projectRoot);
    try {
      const raw = await readFile(paths.statePath, "utf8");
      return RepoSnapshotProjectStateFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isFileNotFound(error)) {
        return {
          version: 1,
          projectRoot,
          manifests: [],
        };
      }
      throw error;
    }
  }
}

function createSettingsSnapshot(
  settingsByUserProject: SettingsByUserProject
): RepoSnapshotIndexingSettingsSnapshot {
  return {
    get(scope) {
      const settings = settingsByUserProject[settingsKey(scope)];
      return settings ? cloneSettings(settings) : null;
    },
  };
}

function createMutableSettingsSnapshot(
  settingsByUserProject: SettingsByUserProject
): MutableRepoSnapshotIndexingSettingsSnapshot {
  const snapshot = createSettingsSnapshot(settingsByUserProject);
  return {
    ...snapshot,
    set(scope, settings) {
      settingsByUserProject[settingsKey(scope)] = cloneSettings(settings);
    },
  };
}

function cloneSettingsByUserProject(
  settingsByUserProject: SettingsByUserProject
): SettingsByUserProject {
  return Object.fromEntries(
    Object.entries(settingsByUserProject).map(([key, settings]) => [
      key,
      cloneSettings(settings),
    ])
  );
}

function cloneSettings(
  settings: RepoSnapshotIndexingSettings
): RepoSnapshotIndexingSettings {
  return { ...settings };
}

function createManifest(input: {
  projectRoot: string;
  index: RepoSnapshotIndexSnapshot;
  reason: string;
  createdAt: string;
}): RepoSnapshotManifest {
  const hash = createSnapshotHash(input.index);
  return {
    schemaVersion: 1,
    id: hash.slice(0, 32),
    manifestPath: "",
    createdAt: input.createdAt,
    reason: input.reason,
    projectRoot: input.projectRoot,
    storagePath: input.index.storagePath,
    indexedAt: input.index.indexedAt,
    indexedFiles: input.index.indexedFiles,
    totalBytes: input.index.totalBytes,
    symbolCount: input.index.symbols.length,
    taskCount: input.index.tasks.length,
    semanticStatus: input.index.semantic.status,
    hash,
    extensions: input.index.extensions,
    fileSample: input.index.files.slice(0, MAX_MANIFEST_FILE_SAMPLE),
    symbolSample: input.index.symbols.slice(0, MAX_MANIFEST_SYMBOL_SAMPLE),
    taskSample: input.index.tasks.slice(0, MAX_MANIFEST_TASK_SAMPLE),
    diagnostics: input.index.diagnostics,
  };
}

function createSnapshotHash(index: RepoSnapshotIndexSnapshot): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        indexedAt: index.indexedAt,
        indexedFiles: index.indexedFiles,
        totalBytes: index.totalBytes,
        files: index.files.map((file) => [
          file.path,
          file.sizeBytes,
          file.modifiedAt,
          file.semanticHash,
          file.embeddingHash,
        ]),
        symbols: index.symbols.map((symbol) => [
          symbol.path,
          symbol.name,
          symbol.kind,
          symbol.line,
        ]),
        tasks: index.tasks.map((task) => [
          task.path,
          task.marker,
          task.line,
          task.text,
        ]),
      })
    )
    .digest("hex");
}

function toStorageState(
  projectRoot: string,
  stateFile: {
    lastAcceptedManifestPath?: string;
    manifests: RepoSnapshotManifest[];
  }
): RepoSnapshotStorageState {
  const paths = projectSnapshotPaths(projectRoot);
  const summaries: RepoSnapshotManifestSummary[] = stateFile.manifests.map(
    (manifest) => ({
      id: manifest.id,
      manifestPath: manifest.manifestPath,
      createdAt: manifest.createdAt,
      reason: manifest.reason,
      indexedAt: manifest.indexedAt,
      indexedFiles: manifest.indexedFiles,
      totalBytes: manifest.totalBytes,
      symbolCount: manifest.symbolCount,
      taskCount: manifest.taskCount,
      semanticStatus: manifest.semanticStatus,
      hash: manifest.hash,
    })
  );
  return RepoSnapshotStorageStateSchema.parse({
    projectRoot,
    statePath: paths.statePath,
    manifestDir: paths.manifestDir,
    lastAcceptedManifestPath: stateFile.lastAcceptedManifestPath,
    manifests: summaries,
    diagnostics:
      summaries.length === 0
        ? ["No repo snapshot manifests have been written yet."]
        : [],
  });
}

function projectSnapshotPaths(projectRoot: string): {
  statePath: string;
  manifestDir: string;
} {
  const root = path.resolve(projectRoot);
  const snapshotDir = path.join(root, ".eragear", "repo-snapshots");
  return {
    statePath: path.join(snapshotDir, "state.json"),
    manifestDir: path.join(snapshotDir, "manifests"),
  };
}

function settingsKey(scope: RepoSnapshotIndexingSettingsScope): string {
  const rootHash = createHash("sha256")
    .update(path.resolve(scope.projectRoot))
    .digest("hex");
  return `${scope.userId}:${rootHash.slice(0, 24)}`;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code?: unknown }).code) === "ENOENT"
  );
}
