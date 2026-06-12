import { describe, expect, test } from "bun:test";
import type {
  DeleteModelProviderInput,
  DeleteModelProviderResult,
  GetModelProviderInput,
  ListModelProvidersInput,
  ModelProviderListResult,
  ModelProviderRecord,
  ModelProviderSeed,
  UpsertModelProviderInput,
} from "./contracts/model-provider.contract";
import { ModelProviderService } from "./model-provider.service";
import type { ModelProviderRepositoryPort } from "./ports/model-provider-repository.port";

class ModelProviderRepositoryStub implements ModelProviderRepositoryPort {
  readonly calls: string[] = [];
  upsertInput: UpsertModelProviderInput | null = null;
  defaults: ModelProviderSeed[] = [];
  record: ModelProviderRecord = {
    id: "provider-1",
    userId: "user-1",
    name: "Provider",
    endpoints: { anthropic: "", openai: "https://example.com/v1", gemini: "" },
    models: ["model-a"],
    modelSupportedFormats: { "model-a": ["openai"] },
    providerMappings: {},
    source: "custom",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };

  list(
    _userId: string,
    _input?: ListModelProvidersInput
  ): Promise<ModelProviderListResult> {
    this.calls.push("list");
    return Promise.resolve({ providers: [this.record], totalCount: 1 });
  }

  get(
    _userId: string,
    _input: GetModelProviderInput
  ): Promise<ModelProviderRecord | null> {
    this.calls.push("get");
    return Promise.resolve(this.record);
  }

  upsert(
    _userId: string,
    input: UpsertModelProviderInput
  ): Promise<ModelProviderRecord> {
    this.calls.push("upsert");
    this.upsertInput = input;
    return Promise.resolve(this.record);
  }

  delete(
    _userId: string,
    _input: DeleteModelProviderInput
  ): Promise<DeleteModelProviderResult> {
    this.calls.push("delete");
    return Promise.resolve({ deleted: true });
  }

  ensureDefaults(
    _userId: string,
    defaults: ModelProviderSeed[]
  ): Promise<void> {
    this.calls.push("ensureDefaults");
    this.defaults = defaults;
    return Promise.resolve();
  }

  restoreDefaults(
    _userId: string,
    defaults: ModelProviderSeed[]
  ): Promise<ModelProviderListResult> {
    this.calls.push("restoreDefaults");
    this.defaults = defaults;
    return Promise.resolve({ providers: [this.record], totalCount: 1 });
  }
}

describe("ModelProviderService", () => {
  test("seeds default providers before list and get", async () => {
    const repository = new ModelProviderRepositoryStub();
    const service = new ModelProviderService(repository);

    await service.list("user-1");
    await service.get("user-1", { id: "provider-1" });

    expect(repository.calls).toEqual([
      "ensureDefaults",
      "list",
      "ensureDefaults",
      "get",
    ]);
    expect(repository.defaults.length).toBeGreaterThanOrEqual(10);
  });

  test("normalizes endpoints, models, mappings, and format support", async () => {
    const repository = new ModelProviderRepositoryStub();
    const service = new ModelProviderService(repository);

    await service.upsert("user-1", {
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

    expect(repository.upsertInput).toEqual({
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
      enabled: false,
    });
  });
});
