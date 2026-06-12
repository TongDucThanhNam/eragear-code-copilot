import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ModelProviderSeed } from "../application/contracts/model-provider.contract";
import { ModelProviderFileRepository } from "./model-provider-file.repository";

let tempDir = "";

beforeEach(async () => {
  tempDir = await makeTempDir();
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("ModelProviderFileRepository", () => {
  test("creates, updates, lists, and deletes provider records", async () => {
    const repository = new ModelProviderFileRepository({
      filePath: path.join(tempDir, "model-providers.json"),
      nowMs: () => 100,
    });

    const created = await repository.upsert("user-1", {
      name: "OpenAI",
      endpoints: {
        anthropic: "",
        openai: "https://api.openai.com/v1",
        gemini: "",
      },
      credentialId: "cred-1",
      models: ["gpt-5"],
      modelSupportedFormats: { "gpt-5": ["openai"] },
      providerMappings: {},
      enabled: true,
    });

    expect(created.id).toStartWith("provider_");
    expect(created.credentialId).toBe("cred-1");

    const updated = await repository.upsert("user-1", {
      id: created.id,
      name: "OpenAI prod",
      endpoints: created.endpoints,
      models: ["gpt-5", "gpt-5-codex"],
      modelSupportedFormats: {
        "gpt-5": ["openai"],
        "gpt-5-codex": ["openai"],
      },
      providerMappings: { claude: { sonnet: "gpt-5-codex" } },
      enabled: false,
    });

    expect(updated.createdAt).toBe(100);
    expect(updated.name).toBe("OpenAI prod");

    const allProviders = await repository.list("user-1", {
      includeDisabled: true,
    });
    expect(allProviders.totalCount).toBe(1);
    expect(allProviders.providers[0]?.enabled).toBe(false);

    const enabledProviders = await repository.list("user-1");
    expect(enabledProviders.totalCount).toBe(0);

    await repository.delete("user-1", { id: created.id });
    expect(
      (await repository.list("user-1", { includeDisabled: true })).totalCount
    ).toBe(0);
  });

  test("seeds defaults only once and can restore missing defaults", async () => {
    const filePath = path.join(tempDir, "model-providers.json");
    const repository = new ModelProviderFileRepository({
      filePath,
      nowMs: () => 200,
    });
    const defaults: ModelProviderSeed[] = [
      {
        id: "default-a",
        name: "Default A",
        endpoints: { anthropic: "", openai: "https://example.com", gemini: "" },
        models: ["model-a"],
        modelSupportedFormats: { "model-a": ["openai"] },
        providerMappings: {},
        source: "default" as const,
        enabled: true,
      },
    ];

    await repository.ensureDefaults("user-1", defaults);
    await repository.delete("user-1", { id: "default-a" });
    await repository.ensureDefaults("user-1", defaults);
    expect(
      (await repository.list("user-1", { includeDisabled: true })).totalCount
    ).toBe(0);

    await repository.restoreDefaults("user-1", defaults);
    const restored = await repository.list("user-1", { includeDisabled: true });
    expect(restored.totalCount).toBe(1);
    expect(restored.providers[0]?.source).toBe("default");

    const raw = await readFile(filePath, "utf8");
    expect(raw).toContain("seededUserIds");
  });
});

async function makeTempDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `eragear-model-provider-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
  await mkdir(dir, { recursive: true });
  return dir;
}
