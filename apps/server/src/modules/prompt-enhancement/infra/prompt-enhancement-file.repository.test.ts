import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PromptEnhancementFileRepository } from "./prompt-enhancement-file.repository";

let tempDir = "";

beforeEach(async () => {
  tempDir = await makeTempDir();
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("PromptEnhancementFileRepository", () => {
  test("persists prompt-enhancement settings snapshots", async () => {
    const filePath = path.join(tempDir, "prompt-enhancement-settings.json");
    const repository = new PromptEnhancementFileRepository({ filePath });

    const empty = await repository.read(
      (snapshot) => snapshot.settingsByUserId
    );
    await repository.mutate((snapshot) => {
      snapshot.settingsByUserId["user-1"] = {
        enabled: true,
        includeProjectContext: true,
        includeDate: false,
        instructionMode: "concise",
        customInstruction: "Use compact responses.",
      };
    });
    const settings = await repository.read(
      (snapshot) => snapshot.settingsByUserId["user-1"]
    );

    const raw = await readFile(filePath, "utf8");

    expect(empty).toEqual({});
    expect(settings).toEqual({
      enabled: true,
      includeProjectContext: true,
      includeDate: false,
      instructionMode: "concise",
      customInstruction: "Use compact responses.",
    });
    expect(raw).toContain('"version": 1');
    expect(raw).toContain("user-1");
    expect(raw).toContain("Use compact responses.");
  });
});

async function makeTempDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `eragear-prompt-enhancement-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
  await mkdir(dir, { recursive: true });
  return dir;
}
