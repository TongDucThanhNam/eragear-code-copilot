import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerminalSettingsFileRepository } from "./terminal-settings-file.repository";

let tempDir = "";

beforeEach(async () => {
  tempDir = await makeTempDir();
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("TerminalSettingsFileRepository", () => {
  test("persists terminal settings snapshots", async () => {
    const filePath = path.join(tempDir, "terminal-settings.json");
    const repository = new TerminalSettingsFileRepository({ filePath });

    await expect(
      repository.read((snapshot) => snapshot.settingsByUserId)
    ).resolves.toEqual({});

    const updated = await repository.mutate((snapshot) => {
      const next = {
        inheritSystemProfile: false,
        shellCommand: "node",
        shellArgs: ["-i"],
      };
      snapshot.settingsByUserId["user-1"] = next;
      return next;
    });

    expect(updated).toEqual({
      inheritSystemProfile: false,
      shellCommand: "node",
      shellArgs: ["-i"],
    });
    await expect(
      repository.read((snapshot) => snapshot.settingsByUserId["user-2"])
    ).resolves.toBeUndefined();

    const raw = await readFile(filePath, "utf8");
    expect(raw).toContain('"version": 1');
    expect(raw).toContain("user-1");
  });
});

async function makeTempDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `eragear-terminal-settings-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
  await mkdir(dir, { recursive: true });
  return dir;
}
