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
  test("persists per-user terminal settings", async () => {
    const filePath = path.join(tempDir, "terminal-settings.json");
    const repository = new TerminalSettingsFileRepository({ filePath });

    expect((await repository.getSettings("user-1")).inheritSystemProfile).toBe(
      true
    );

    const updated = await repository.updateSettings("user-1", {
      inheritSystemProfile: false,
      shellCommand: "node",
      shellArgs: ["-i"],
    });

    expect(updated).toEqual({
      inheritSystemProfile: false,
      shellCommand: "node",
      shellArgs: ["-i"],
    });
    expect((await repository.getSettings("user-2")).shellCommand).toBe("");
    expect(await readFile(filePath, "utf8")).toContain("user-1");
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
