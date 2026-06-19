import { randomUUID } from "node:crypto";
import { NotFoundError, ValidationError } from "#runtime/shared/errors";
import type {
  DeleteModelProviderInput,
  DeleteModelProviderResult,
  GetModelProviderInput,
  ListModelProvidersInput,
  ModelProviderEndpoints,
  ModelProviderFormat,
  ModelProviderListResult,
  ModelProviderMapping,
  ModelProviderMappings,
  ModelProviderRecord,
  ModelProviderSeed,
  ModelSupportedFormats,
  UpsertModelProviderInput,
} from "./contracts/model-provider.contract";
import { ModelProviderRecordSchema } from "./contracts/model-provider.contract";
import { DEFAULT_MODEL_PROVIDERS } from "./default-model-providers";
import type {
  ModelProviderRepositoryPort,
  MutableModelProviderStoreSnapshot,
} from "./ports/model-provider-repository.port";

const MODULE = "model-provider";
const FORMAT_ORDER: ModelProviderFormat[] = ["anthropic", "openai", "gemini"];
const MAPPING_KEYS: Array<keyof ModelProviderMapping> = [
  "haiku",
  "sonnet",
  "opus",
  "reasoning",
];

export class ModelProviderService {
  private readonly repository: ModelProviderRepositoryPort;
  private readonly createId: () => string;
  private readonly nowMs: () => number;

  constructor(
    repository: ModelProviderRepositoryPort,
    params: { createId?: () => string; nowMs?: () => number } = {}
  ) {
    this.repository = repository;
    this.createId = params.createId ?? (() => `provider_${randomUUID()}`);
    this.nowMs = params.nowMs ?? (() => Date.now());
  }

  async list(
    userId: string,
    input?: ListModelProvidersInput
  ): Promise<ModelProviderListResult> {
    await this.ensureDefaults(userId);
    return await this.repository.read((snapshot) =>
      listFromProviders(snapshot.providers, userId, input)
    );
  }

  async get(
    userId: string,
    input: GetModelProviderInput
  ): Promise<ModelProviderRecord> {
    await this.ensureDefaults(userId);
    const provider = await this.repository.read(
      (snapshot) =>
        snapshot.providers.find(
          (candidate) =>
            candidate.userId === userId && candidate.id === input.id
        ) ?? null
    );
    if (!provider) {
      throw new NotFoundError("Model provider not found", {
        module: MODULE,
        op: "get",
        details: { providerId: input.id },
      });
    }
    return provider;
  }

  async upsert(
    userId: string,
    input: UpsertModelProviderInput
  ): Promise<ModelProviderRecord> {
    const normalizedInput = normalizeUpsertInput(input);
    return await this.repository.mutate((snapshot) => {
      const now = this.nowMs();
      const existingIndex = normalizedInput.id
        ? snapshot.providers.findIndex(
            (provider) =>
              provider.userId === userId && provider.id === normalizedInput.id
          )
        : -1;
      const previous =
        existingIndex >= 0 ? snapshot.providers[existingIndex] : undefined;
      const provider = ModelProviderRecordSchema.parse({
        id: previous?.id ?? normalizedInput.id ?? this.createId(),
        userId,
        name: normalizedInput.name,
        endpoints: normalizedInput.endpoints,
        ...(normalizedInput.credentialId
          ? { credentialId: normalizedInput.credentialId }
          : {}),
        ...(normalizedInput.apiKeyUrl
          ? { apiKeyUrl: normalizedInput.apiKeyUrl }
          : {}),
        models: normalizedInput.models,
        modelSupportedFormats: normalizedInput.modelSupportedFormats ?? {},
        providerMappings: normalizedInput.providerMappings ?? {},
        source: previous?.source ?? "custom",
        enabled: normalizedInput.enabled ?? previous?.enabled ?? true,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });

      if (existingIndex >= 0) {
        snapshot.providers[existingIndex] = provider;
      } else {
        snapshot.providers.push(provider);
      }
      return provider;
    });
  }

  async delete(
    userId: string,
    input: DeleteModelProviderInput
  ): Promise<DeleteModelProviderResult> {
    return await this.repository.mutate((snapshot) => {
      const index = snapshot.providers.findIndex(
        (provider) => provider.userId === userId && provider.id === input.id
      );
      if (index === -1) {
        throw new NotFoundError("Model provider not found", {
          module: MODULE,
          op: "delete",
          details: { providerId: input.id },
        });
      }
      snapshot.providers.splice(index, 1);
      return { deleted: true as const };
    });
  }

  async restoreDefaults(userId: string): Promise<ModelProviderListResult> {
    return await this.repository.mutate((snapshot) => {
      addMissingDefaults(
        snapshot,
        userId,
        DEFAULT_MODEL_PROVIDERS,
        this.nowMs()
      );
      if (!snapshot.seededUserIds.includes(userId)) {
        snapshot.seededUserIds.push(userId);
      }
      return listFromProviders(snapshot.providers, userId, {
        includeDisabled: true,
      });
    });
  }

  private async ensureDefaults(userId: string): Promise<void> {
    await this.repository.mutate((snapshot) => {
      if (snapshot.seededUserIds.includes(userId)) {
        return;
      }
      addMissingDefaults(
        snapshot,
        userId,
        DEFAULT_MODEL_PROVIDERS,
        this.nowMs()
      );
      snapshot.seededUserIds.push(userId);
    });
  }
}

function addMissingDefaults(
  snapshot: MutableModelProviderStoreSnapshot,
  userId: string,
  defaults: readonly ModelProviderSeed[],
  now: number
): void {
  const existingIds = new Set(
    snapshot.providers
      .filter((provider) => provider.userId === userId)
      .map((provider) => provider.id)
  );
  for (const seed of defaults) {
    if (existingIds.has(seed.id)) {
      continue;
    }
    snapshot.providers.push(
      ModelProviderRecordSchema.parse({
        ...seed,
        userId,
        createdAt: now,
        updatedAt: now,
      })
    );
    existingIds.add(seed.id);
  }
}

function listFromProviders(
  providers: readonly ModelProviderRecord[],
  userId: string,
  input?: ListModelProvidersInput
): ModelProviderListResult {
  const filteredProviders = providers
    .filter((provider) => provider.userId === userId)
    .filter((provider) => input?.includeDisabled || provider.enabled)
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    providers: filteredProviders,
    totalCount: filteredProviders.length,
  };
}

function normalizeUpsertInput(
  input: UpsertModelProviderInput
): UpsertModelProviderInput {
  const name = input.name.trim();
  if (!name) {
    throw new ValidationError("Model provider name is required", {
      module: MODULE,
      op: "upsert",
    });
  }

  const endpoints = normalizeEndpoints(input.endpoints);
  const models = uniqueTrimmed(input.models);
  const modelSupportedFormats = normalizeSupportedFormats(
    models,
    endpoints,
    input.modelSupportedFormats
  );
  const providerMappings = normalizeMappings(input.providerMappings);
  const credentialId = input.credentialId?.trim();
  const apiKeyUrl = input.apiKeyUrl?.trim();

  return {
    ...(input.id ? { id: input.id.trim() } : {}),
    name,
    endpoints,
    ...(credentialId ? { credentialId } : {}),
    ...(apiKeyUrl ? { apiKeyUrl } : {}),
    models,
    modelSupportedFormats,
    providerMappings,
    enabled: input.enabled ?? true,
  };
}

function normalizeEndpoints(endpoints: ModelProviderEndpoints) {
  return {
    anthropic: endpoints.anthropic?.trim() ?? "",
    openai: endpoints.openai?.trim() ?? "",
    gemini: endpoints.gemini?.trim() ?? "",
  };
}

function uniqueTrimmed(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const item = value.trim();
    if (!(item && !seen.has(item))) {
      continue;
    }
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
}

function normalizeSupportedFormats(
  models: string[],
  endpoints: ModelProviderEndpoints,
  input?: ModelSupportedFormats
): ModelSupportedFormats {
  const defaults = formatsFromEndpoints(endpoints);
  const supported: ModelSupportedFormats = {};
  for (const model of models) {
    const formats = uniqueFormats(input?.[model] ?? defaults);
    supported[model] = formats.length > 0 ? formats : defaults;
  }
  return supported;
}

function formatsFromEndpoints(
  endpoints: ModelProviderEndpoints
): ModelProviderFormat[] {
  const formats = FORMAT_ORDER.filter((format) => Boolean(endpoints[format]));
  return formats.length > 0 ? formats : ["openai"];
}

function uniqueFormats(values: ModelProviderFormat[]): ModelProviderFormat[] {
  const requested = new Set(values);
  return FORMAT_ORDER.filter((format) => requested.has(format));
}

function normalizeMappings(
  input?: ModelProviderMappings
): ModelProviderMappings {
  if (!input) {
    return {};
  }
  const mappings: ModelProviderMappings = {};
  for (const [family, mapping] of Object.entries(input)) {
    const normalizedFamily = family.trim();
    if (!normalizedFamily) {
      continue;
    }
    const normalizedMapping: ModelProviderMapping = {};
    for (const key of MAPPING_KEYS) {
      const value = mapping[key]?.trim();
      if (value) {
        normalizedMapping[key] = value;
      }
    }
    mappings[normalizedFamily] = normalizedMapping;
  }
  return mappings;
}
