import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OutputStyleFileRepository } from "./output-style-file.repository";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "eragear-output-style-"));
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("persists output-style settings snapshots", async () => {
  const filePath = path.join(tempDir, "output-style-settings.json");
  const repository = new OutputStyleFileRepository({
    filePath: () => filePath,
  });

  const empty = await repository.read((snapshot) => snapshot.settingsByUserId);
  await repository.mutate((snapshot) => {
    snapshot.settingsByUserId["user-1"] = {
      enabled: true,
      activePresetId: "concise",
      updatedAt: 1000,
    };
  });
  const settings = await repository.read(
    (snapshot) => snapshot.settingsByUserId["user-1"]
  );
  const raw = await readFile(filePath, "utf8");

  expect(empty).toEqual({});
  expect(settings).toEqual({
    enabled: true,
    activePresetId: "concise",
    updatedAt: 1000,
  });
  expect(raw).toContain('"version": 1');
  expect(raw).toContain('"user-1"');
});
