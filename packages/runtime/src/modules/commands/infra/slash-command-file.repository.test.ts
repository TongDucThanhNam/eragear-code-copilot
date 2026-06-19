import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SlashCommandFileRepository } from "./slash-command-file.repository";

let tempDir = "";

beforeEach(async () => {
  tempDir = await makeTempDir();
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("SlashCommandFileRepository", () => {
  test("persists custom slash command snapshots", async () => {
    const filePath = path.join(tempDir, "slash-commands.json");
    const repository = new SlashCommandFileRepository({
      filePath: () => filePath,
    });

    await expect(
      repository.read((snapshot) => snapshot.commandsByUserId)
    ).resolves.toEqual({});

    const command = await repository.mutate((snapshot) => {
      const next = {
        id: "command.custom.review",
        userId: "user-1",
        name: "/review",
        prompt: "Review code",
        sourcePath: "eragear://commands/command.custom.review",
        enabled: true,
        scope: "user" as const,
        storage: "custom" as const,
        tags: ["user", "custom"],
        diagnostics: [],
        createdAt: 100,
        updatedAt: 100,
      };
      snapshot.commandsByUserId["user-1"] = [next];
      return next;
    });

    expect(command.name).toBe("/review");
    await expect(
      repository.read((snapshot) => snapshot.commandsByUserId["user-1"])
    ).resolves.toHaveLength(1);

    const raw = await readFile(filePath, "utf8");
    expect(raw).toContain('"version": 1');
    expect(raw).toContain("command.custom.review");
  });
});

async function makeTempDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `eragear-slash-commands-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
  await mkdir(dir, { recursive: true });
  return dir;
}
