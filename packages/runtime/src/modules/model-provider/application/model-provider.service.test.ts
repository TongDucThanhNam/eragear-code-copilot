import { describe, expect, test } from "bun:test";
import { ModelProviderService } from "./model-provider.service";
import type {
  ModelProviderRepositoryPort,
  ModelProviderStoreSnapshot,
  MutableModelProviderStoreSnapshot,
} from "./ports/model-provider-repository.port";

class MemoryModelProviderRepository implements ModelProviderRepositoryPort {
  readonly snapshot: MutableModelProviderStoreSnapshot = {
    seededUserIds: [],
    providers: [],
  };

  async read<T>(
    reader: (snapshot: ModelProviderStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await reader(cloneSnapshot(this.snapshot));
  }

  async mutate<T>(
    mutator: (snapshot: MutableModelProviderStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await mutator(this.snapshot);
  }
}

describe("ModelProviderService", () => {
  test("seeds default providers once and restores missing defaults on request", async () => {
    const repository = new MemoryModelProviderRepository();
    const service = new ModelProviderService(repository, {
      nowMs: () => 100,
    });

    const seeded = await service.list("user-1", { includeDisabled: true });
    const deletedProvider = seeded.providers[0];
    if (!deletedProvider) {
      throw new Error("Expected default model providers to be seeded");
    }

    await service.delete("user-1", { id: deletedProvider.id });
    const afterDelete = await service.list("user-1", {
      includeDisabled: true,
    });
    const restored = await service.restoreDefaults("user-1");

    expect(repository.snapshot.seededUserIds).toEqual(["user-1"]);
    expect(seeded.totalCount).toBeGreaterThanOrEqual(10);
    expect(afterDelete.totalCount).toBe(seeded.totalCount - 1);
    expect(restored.totalCount).toBe(seeded.totalCount);
    expect(
      restored.providers.some((item) => item.id === deletedProvider.id)
    ).toBe(true);
  });

  test("normalizes provider records and lists only enabled providers by default", async () => {
    const repository = new MemoryModelProviderRepository();
    let now = 100;
    const service = new ModelProviderService(repository, {
      createId: () => "provider-custom",
      nowMs: () => now,
    });

    const created = await service.upsert("user-1", {
      name: "  OpenRouter  ",
      endpoints: {
        anthropic: " https://example.com/anthropic ",
        openai: " https://example.com/v1 ",
        gemini: "",
      },
      credentialId: " cred-1 ",
      apiKeyUrl: " https://example.com/keys ",
      models: [" model-a ", "model-a", "model-b"],
      modelSupportedFormats: {
        "model-a": ["openai", "anthropic", "openai"],
      },
      providerMappings: {
        " claude ": {
          haiku: " model-a ",
          sonnet: "model-b",
          opus: "",
          reasoning: " model-b ",
        },
      },
      enabled: false,
    });
    now = 200;
    const updated = await service.upsert("user-1", {
      id: created.id,
      name: "OpenRouter prod",
      endpoints: created.endpoints,
      models: ["model-b"],
      modelSupportedFormats: { "model-b": ["openai"] },
      providerMappings: {},
      enabled: false,
    });

    const enabledOnly = await service.list("user-1");
    const allProviders = await service.list("user-1", {
      includeDisabled: true,
    });

    expect(created).toEqual({
      id: "provider-custom",
      userId: "user-1",
      name: "OpenRouter",
      endpoints: {
        anthropic: "https://example.com/anthropic",
        openai: "https://example.com/v1",
        gemini: "",
      },
      credentialId: "cred-1",
      apiKeyUrl: "https://example.com/keys",
      models: ["model-a", "model-b"],
      modelSupportedFormats: {
        "model-a": ["anthropic", "openai"],
        "model-b": ["anthropic", "openai"],
      },
      providerMappings: {
        claude: {
          haiku: "model-a",
          sonnet: "model-b",
          reasoning: "model-b",
        },
      },
      source: "custom",
      enabled: false,
      createdAt: 100,
      updatedAt: 100,
    });
    expect(updated.createdAt).toBe(100);
    expect(updated.updatedAt).toBe(200);
    expect(updated.name).toBe("OpenRouter prod");
    expect(enabledOnly.providers.some((item) => item.id === created.id)).toBe(
      false
    );
    expect(allProviders.providers.some((item) => item.id === created.id)).toBe(
      true
    );
  });

  test("scopes provider access to the owning user", async () => {
    const repository = new MemoryModelProviderRepository();
    const service = new ModelProviderService(repository, {
      createId: () => "provider-custom",
      nowMs: () => 100,
    });

    const provider = await service.upsert("user-1", {
      name: "OpenAI",
      endpoints: {
        anthropic: "",
        openai: "https://api.openai.com/v1",
        gemini: "",
      },
      models: ["gpt-5"],
    });

    await expect(service.get("user-2", { id: provider.id })).rejects.toThrow(
      "Model provider not found"
    );
    await expect(service.delete("user-2", { id: provider.id })).rejects.toThrow(
      "Model provider not found"
    );
    await expect(
      service.delete("user-1", { id: provider.id })
    ).resolves.toEqual({ deleted: true });
  });
});

function cloneSnapshot(
  snapshot: MutableModelProviderStoreSnapshot
): ModelProviderStoreSnapshot {
  return {
    seededUserIds: [...snapshot.seededUserIds],
    providers: snapshot.providers.map((provider) => ({
      ...provider,
      endpoints: { ...provider.endpoints },
      models: [...provider.models],
      modelSupportedFormats: Object.fromEntries(
        Object.entries(provider.modelSupportedFormats).map(
          ([model, formats]) => [model, [...formats]]
        )
      ),
      providerMappings: Object.fromEntries(
        Object.entries(provider.providerMappings).map(([family, mapping]) => [
          family,
          { ...mapping },
        ])
      ),
    })),
  };
}
