import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { UsageStatsFileRepository } from "./usage-stats-file.repository";

describe("UsageStatsFileRepository", () => {
  test("persists telemetry settings through the telemetry snapshot seam", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "usage-stats-file-"));
    const filePath = path.join(root, "usage-stats.json");

    try {
      const repository = new UsageStatsFileRepository({
        filePath: () => filePath,
      });

      await repository.mutateTelemetrySettings("user-1", (snapshot) => {
        snapshot.set({
          enabled: true,
          updatedAt: 10,
        });
      });

      const loaded = await repository.readTelemetrySettings(
        "user-1",
        (snapshot) => snapshot.get()
      );
      expect(loaded).toEqual({
        enabled: true,
        updatedAt: 10,
      });

      if (loaded) {
        loaded.enabled = false;
      }

      await expect(
        repository.readTelemetrySettings("user-1", (snapshot) => snapshot.get())
      ).resolves.toEqual({
        enabled: true,
        updatedAt: 10,
      });
      await expect(readPersistedTelemetryUsers(filePath)).resolves.toEqual([
        "user-1",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function readPersistedTelemetryUsers(
  filePath: string
): Promise<string[]> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as {
    telemetryByUserId?: Record<string, unknown>;
  };
  return Object.keys(parsed.telemetryByUserId ?? {});
}
