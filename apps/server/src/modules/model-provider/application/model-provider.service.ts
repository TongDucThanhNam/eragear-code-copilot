import { NotFoundError, ValidationError } from "@/shared/errors";
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
  ModelSupportedFormats,
  UpsertModelProviderInput,
} from "./contracts/model-provider.contract";
import { DEFAULT_MODEL_PROVIDERS } from "./default-model-providers";
import type { ModelProviderRepositoryPort } from "./ports/model-provider-repository.port";

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

  constructor(repository: ModelProviderRepositoryPort) {
    this.repository = repository;
  }

  async list(
    userId: string,
    input?: ListModelProvidersInput
  ): Promise<ModelProviderListResult> {
    await this.repository.ensureDefaults(userId, DEFAULT_MODEL_PROVIDERS);
    return await this.repository.list(userId, input);
  }

  async get(
    userId: string,
    input: GetModelProviderInput
  ): Promise<ModelProviderRecord> {
    await this.repository.ensureDefaults(userId, DEFAULT_MODEL_PROVIDERS);
    const provider = await this.repository.get(userId, input);
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
    return await this.repository.upsert(userId, normalizeUpsertInput(input));
  }

  async delete(
    userId: string,
    input: DeleteModelProviderInput
  ): Promise<DeleteModelProviderResult> {
    return await this.repository.delete(userId, input);
  }

  async restoreDefaults(userId: string): Promise<ModelProviderListResult> {
    return await this.repository.restoreDefaults(
      userId,
      DEFAULT_MODEL_PROVIDERS
    );
  }
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
