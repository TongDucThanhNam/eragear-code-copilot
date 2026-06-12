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
  test("returns defaults and persists per-user updates", async () => {
    const filePath = path.join(tempDir, "prompt-enhancement-settings.json");
    const repository = new PromptEnhancementFileRepository({ filePath });

    const defaults = await repository.getSettings("user-1");
    expect(defaults.enabled).toBe(false);
    expect(defaults.instructionMode).toBe("execution");

    const updated = await repository.updateSettings("user-1", {
      enabled: true,
      includeDate: false,
      instructionMode: "concise",
      customInstruction: "Use compact responses.",
    });

    expect(updated.enabled).toBe(true);
    expect(updated.includeProjectContext).toBe(true);
    expect(updated.includeDate).toBe(false);

    const otherUser = await repository.getSettings("user-2");
    expect(otherUser.enabled).toBe(false);

    const raw = await readFile(filePath, "utf8");
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
