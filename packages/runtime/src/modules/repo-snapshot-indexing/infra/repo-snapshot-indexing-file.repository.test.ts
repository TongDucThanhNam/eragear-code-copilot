import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RepoSnapshotIndexingSettingsScope } from "../application/ports/repo-snapshot-indexing-repository.port";
import { RepoSnapshotIndexingFileRepository } from "./repo-snapshot-indexing-file.repository";

describe("RepoSnapshotIndexingFileRepository", () => {
  test("persists settings through the settings snapshot seam", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "repo-snapshot-indexing-"));
    const filePath = path.join(root, "settings", "repo-snapshots.json");
    const projectRoot = path.join(root, "project");
    const scope: RepoSnapshotIndexingSettingsScope = {
      userId: "user-1",
      projectRoot,
    };

    await mkdir(projectRoot, { recursive: true });
    try {
      const repository = new RepoSnapshotIndexingFileRepository({
        filePath: () => filePath,
      });

      await repository.mutateSettings((snapshot) => {
        snapshot.set(scope, {
          enabled: false,
          userConfigured: true,
          updatedAt: "2026-06-13T00:00:00.000Z",
          lastRefreshAt: "2026-06-13T00:10:00.000Z",
        });
      });

      const loaded = await repository.readSettings((snapshot) =>
        snapshot.get(scope)
      );
      expect(loaded).toEqual({
        enabled: false,
        userConfigured: true,
        updatedAt: "2026-06-13T00:00:00.000Z",
        lastRefreshAt: "2026-06-13T00:10:00.000Z",
      });

      if (loaded) {
        loaded.enabled = true;
      }

      await expect(
        repository.readSettings((snapshot) => snapshot.get(scope))
      ).resolves.toMatchObject({ enabled: false });
      await expect(readPersistedSettingsKeys(filePath)).resolves.toHaveLength(
        1
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function readPersistedSettingsKeys(filePath: string): Promise<string[]> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as {
    settingsByUserProject?: Record<string, unknown>;
  };
  return Object.keys(parsed.settingsByUserProject ?? {});
}
