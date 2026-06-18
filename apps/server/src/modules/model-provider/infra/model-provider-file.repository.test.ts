import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModelProviderService } from "../application/model-provider.service";
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
    });
    let now = 100;
    const service = new ModelProviderService(repository, {
      createId: () => "provider_file_test",
      nowMs: () => now,
    });

    const created = await service.upsert("user-1", {
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

    expect(created.id).toBe("provider_file_test");
    expect(created.credentialId).toBe("cred-1");

    now = 200;
    const updated = await service.upsert("user-1", {
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
    expect(updated.updatedAt).toBe(200);
    expect(updated.name).toBe("OpenAI prod");

    const allProviders = await service.list("user-1", {
      includeDisabled: true,
    });
    const listedCustomProvider = allProviders.providers.find(
      (provider) => provider.id === created.id
    );
    expect(
      allProviders.providers.some((provider) => provider.id === created.id)
    ).toBe(true);
    expect(listedCustomProvider?.enabled).toBe(false);

    const enabledProviders = await service.list("user-1");
    expect(
      enabledProviders.providers.some((provider) => provider.id === created.id)
    ).toBe(false);

    await service.delete("user-1", { id: created.id });
    expect(
      (
        await service.list("user-1", {
          includeDisabled: true,
        })
      ).providers.some((provider) => provider.id === created.id)
    ).toBe(false);
  });

  test("seeds defaults only once and can restore missing defaults", async () => {
    const filePath = path.join(tempDir, "model-providers.json");
    const repository = new ModelProviderFileRepository({
      filePath,
    });
    const service = new ModelProviderService(repository, { nowMs: () => 200 });

    const seeded = await service.list("user-1", { includeDisabled: true });
    const deletedDefault = seeded.providers[0];
    if (!deletedDefault) {
      throw new Error("Expected default model providers to be seeded");
    }

    await service.delete("user-1", { id: deletedDefault.id });
    const afterDelete = await service.list("user-1", {
      includeDisabled: true,
    });
    expect(afterDelete.totalCount).toBe(seeded.totalCount - 1);

    const restored = await service.restoreDefaults("user-1");
    expect(restored.totalCount).toBe(seeded.totalCount);
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
