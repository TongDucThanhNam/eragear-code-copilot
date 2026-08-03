import {
  DEFAULT_SUPERVISOR_CUSTOM_SYSTEM_PROMPT,
  DEFAULT_SUPERVISOR_DECISION_MAX_ATTEMPTS,
  DEFAULT_SUPERVISOR_DECISION_TIMEOUT_MS,
  DEFAULT_SUPERVISOR_MAX_REPEATED_PROMPTS,
  DEFAULT_SUPERVISOR_MAX_RUNTIME_MS,
  DEFAULT_SUPERVISOR_MEMORY_PROVIDER,
  DEFAULT_SUPERVISOR_OBSIDIAN_COMMAND,
  DEFAULT_SUPERVISOR_OBSIDIAN_SEARCH_LIMIT,
  DEFAULT_SUPERVISOR_OBSIDIAN_SEARCH_PATH,
  DEFAULT_SUPERVISOR_OBSIDIAN_TIMEOUT_MS,
  DEFAULT_SUPERVISOR_TOOL_ALLOWLIST,
  DEFAULT_SUPERVISOR_TOOL_POLICY,
  DEFAULT_SUPERVISOR_WEB_SEARCH_PROVIDER,
  HARD_MAX_APP_MAX_TOKENS,
  HARD_MAX_SESSION_LIST_PAGE_LIMIT,
  HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT,
} from "#runtime/config/constants";
import { ENV } from "#runtime/config/environment";
import {
  AppConfigPatchSchema,
  AppConfigSchema,
} from "#runtime/shared/contracts/settings.contract";
import { LOG_LEVELS, type LogLevel } from "#runtime/shared/types/log.types";
import type { AppConfig, Settings } from "#runtime/shared/types/settings.types";
import { isRecord } from "#runtime/shared/utils/type-guards.util";
import type { SettingsRepositoryPort } from "./application/ports/settings-repository.port";

const MAX_SESSION_IDLE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;

export const APP_CONFIG_KEYS = [
  "sessionIdleTimeoutMs",
  "sessionListPageMaxLimit",
  "sessionMessagesPageMaxLimit",
  "logLevel",
  "maxTokens",
  "defaultModel",
  "supervisorEnabled",
  "supervisorModel",
  "supervisorMiniMaxApiKey",
  "supervisorDecisionTimeoutMs",
  "supervisorDecisionMaxAttempts",
  "supervisorMaxRuntimeMs",
  "supervisorMaxRepeatedPrompts",
  "supervisorCustomSystemPrompt",
  "supervisorToolPolicy",
  "supervisorToolAllowlist",
  "supervisorWebSearchProvider",
  "supervisorWebSearchApiKey",
  "supervisorMemoryProvider",
  "supervisorObsidianCommand",
  "supervisorObsidianVault",
  "supervisorObsidianBlueprintPath",
  "supervisorObsidianLogPath",
  "supervisorObsidianSearchPath",
  "supervisorObsidianSearchLimit",
  "supervisorObsidianTimeoutMs",
  "projectIndexEmbeddingEndpoint",
  "projectIndexEmbeddingModel",
  "projectIndexEmbeddingApiKey",
  "projectIndexEmbeddingTimeoutMs",
  "acpPromptMetaPolicy",
  "acpPromptMetaAllowlist",
] as const;

export type AppConfigKey = (typeof APP_CONFIG_KEYS)[number];

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

const LOG_LEVEL_SET = new Set(LOG_LEVELS);
const PROMPT_META_POLICY_SET = new Set<AppConfig["acpPromptMetaPolicy"]>([
  "allowlist",
  "always",
  "never",
]);
const DEFAULT_ACP_PROMPT_META_POLICY: AppConfig["acpPromptMetaPolicy"] =
  "allowlist";
const DEFAULT_ACP_PROMPT_META_ALLOWLIST: string[] = [];
const DEFAULT_PROJECT_INDEX_EMBEDDING_MODEL = "text-embedding-3-small";
const SUPERVISOR_WEB_SEARCH_PROVIDER_SET = new Set<
  AppConfig["supervisorWebSearchProvider"]
>(["none", "exa"]);
const SUPERVISOR_MEMORY_PROVIDER_SET = new Set<
  AppConfig["supervisorMemoryProvider"]
>(["none", "obsidian"]);
const SUPERVISOR_TOOL_POLICY_SET = new Set<AppConfig["supervisorToolPolicy"]>([
  "builtin",
  "custom-allowlist",
]);

function toLogLevel(value: unknown): LogLevel | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!LOG_LEVEL_SET.has(normalized as LogLevel)) {
    return undefined;
  }
  return normalized as LogLevel;
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "";
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function toPromptMetaPolicy(
  value: unknown
): AppConfig["acpPromptMetaPolicy"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (
    !PROMPT_META_POLICY_SET.has(normalized as AppConfig["acpPromptMetaPolicy"])
  ) {
    return undefined;
  }
  return normalized as AppConfig["acpPromptMetaPolicy"];
}

function toPromptMetaAllowlist(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const entries = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
    return [...new Set(entries)];
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const entries = value
    .split(/[,\n]/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return [...new Set(entries)];
}

function toSupervisorWebSearchProvider(
  value: unknown
): AppConfig["supervisorWebSearchProvider"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (
    !SUPERVISOR_WEB_SEARCH_PROVIDER_SET.has(
      normalized as AppConfig["supervisorWebSearchProvider"]
    )
  ) {
    return undefined;
  }
  return normalized as AppConfig["supervisorWebSearchProvider"];
}

function toSupervisorMemoryProvider(
  value: unknown
): AppConfig["supervisorMemoryProvider"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (
    !SUPERVISOR_MEMORY_PROVIDER_SET.has(
      normalized as AppConfig["supervisorMemoryProvider"]
    )
  ) {
    return undefined;
  }
  return normalized as AppConfig["supervisorMemoryProvider"];
}

function toSupervisorToolPolicy(
  value: unknown
): AppConfig["supervisorToolPolicy"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (
    !SUPERVISOR_TOOL_POLICY_SET.has(
      normalized as AppConfig["supervisorToolPolicy"]
    )
  ) {
    return undefined;
  }
  return normalized as AppConfig["supervisorToolPolicy"];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: AppConfig normalization is centralized so migrations keep one fallback path.
function normalizeFromUnknown(value: unknown, fallback: AppConfig): AppConfig {
  if (!isRecord(value)) {
    return fallback;
  }

  const next = {
    sessionIdleTimeoutMs: clampInt(
      toFiniteNumber(value.sessionIdleTimeoutMs) ??
        fallback.sessionIdleTimeoutMs,
      1,
      MAX_SESSION_IDLE_TIMEOUT_MS
    ),
    sessionListPageMaxLimit: clampInt(
      toFiniteNumber(value.sessionListPageMaxLimit) ??
        fallback.sessionListPageMaxLimit,
      1,
      HARD_MAX_SESSION_LIST_PAGE_LIMIT
    ),
    sessionMessagesPageMaxLimit: clampInt(
      toFiniteNumber(value.sessionMessagesPageMaxLimit) ??
        fallback.sessionMessagesPageMaxLimit,
      1,
      HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT
    ),
    logLevel: toLogLevel(value.logLevel) ?? fallback.logLevel,
    maxTokens: clampInt(
      toFiniteNumber(value.maxTokens) ?? fallback.maxTokens,
      1,
      HARD_MAX_APP_MAX_TOKENS
    ),
    defaultModel:
      toTrimmedString(value.defaultModel) ?? fallback.defaultModel ?? "",
    supervisorEnabled:
      toBoolean(value.supervisorEnabled) ?? fallback.supervisorEnabled,
    supervisorModel:
      toTrimmedString(value.supervisorModel) ?? fallback.supervisorModel ?? "",
    supervisorMiniMaxApiKey:
      toTrimmedString(value.supervisorMiniMaxApiKey) ??
      fallback.supervisorMiniMaxApiKey ??
      "",
    supervisorDecisionTimeoutMs: clampInt(
      toFiniteNumber(value.supervisorDecisionTimeoutMs) ??
        fallback.supervisorDecisionTimeoutMs,
      1000,
      120_000
    ),
    supervisorDecisionMaxAttempts: clampInt(
      toFiniteNumber(value.supervisorDecisionMaxAttempts) ??
        fallback.supervisorDecisionMaxAttempts,
      1,
      10
    ),
    supervisorMaxRuntimeMs: clampInt(
      toFiniteNumber(value.supervisorMaxRuntimeMs) ??
        fallback.supervisorMaxRuntimeMs,
      1000,
      24 * 60 * 60 * 1000
    ),
    supervisorMaxRepeatedPrompts: clampInt(
      toFiniteNumber(value.supervisorMaxRepeatedPrompts) ??
        fallback.supervisorMaxRepeatedPrompts,
      1,
      200
    ),
    supervisorCustomSystemPrompt:
      toTrimmedString(value.supervisorCustomSystemPrompt) ??
      fallback.supervisorCustomSystemPrompt ??
      DEFAULT_SUPERVISOR_CUSTOM_SYSTEM_PROMPT,
    supervisorToolPolicy:
      toSupervisorToolPolicy(value.supervisorToolPolicy) ??
      fallback.supervisorToolPolicy ??
      DEFAULT_SUPERVISOR_TOOL_POLICY,
    supervisorToolAllowlist:
      toPromptMetaAllowlist(value.supervisorToolAllowlist) ??
      fallback.supervisorToolAllowlist ??
      DEFAULT_SUPERVISOR_TOOL_ALLOWLIST,
    supervisorWebSearchProvider:
      toSupervisorWebSearchProvider(value.supervisorWebSearchProvider) ??
      fallback.supervisorWebSearchProvider ??
      DEFAULT_SUPERVISOR_WEB_SEARCH_PROVIDER,
    supervisorWebSearchApiKey:
      toTrimmedString(value.supervisorWebSearchApiKey) ??
      fallback.supervisorWebSearchApiKey ??
      "",
    supervisorMemoryProvider:
      toSupervisorMemoryProvider(value.supervisorMemoryProvider) ??
      fallback.supervisorMemoryProvider ??
      DEFAULT_SUPERVISOR_MEMORY_PROVIDER,
    supervisorObsidianCommand:
      toTrimmedString(value.supervisorObsidianCommand) ??
      fallback.supervisorObsidianCommand ??
      DEFAULT_SUPERVISOR_OBSIDIAN_COMMAND,
    supervisorObsidianVault:
      toTrimmedString(value.supervisorObsidianVault) ??
      fallback.supervisorObsidianVault ??
      "",
    supervisorObsidianBlueprintPath:
      toTrimmedString(value.supervisorObsidianBlueprintPath) ??
      fallback.supervisorObsidianBlueprintPath ??
      "",
    supervisorObsidianLogPath:
      toTrimmedString(value.supervisorObsidianLogPath) ??
      fallback.supervisorObsidianLogPath ??
      "",
    supervisorObsidianSearchPath:
      toTrimmedString(value.supervisorObsidianSearchPath) ??
      fallback.supervisorObsidianSearchPath ??
      DEFAULT_SUPERVISOR_OBSIDIAN_SEARCH_PATH,
    supervisorObsidianSearchLimit: clampInt(
      toFiniteNumber(value.supervisorObsidianSearchLimit) ??
        fallback.supervisorObsidianSearchLimit,
      1,
      20
    ),
    supervisorObsidianTimeoutMs: clampInt(
      toFiniteNumber(value.supervisorObsidianTimeoutMs) ??
        fallback.supervisorObsidianTimeoutMs,
      1000,
      60_000
    ),
    projectIndexEmbeddingEndpoint:
      toTrimmedString(value.projectIndexEmbeddingEndpoint) ??
      fallback.projectIndexEmbeddingEndpoint ??
      "",
    projectIndexEmbeddingModel:
      toTrimmedString(value.projectIndexEmbeddingModel) ??
      fallback.projectIndexEmbeddingModel ??
      DEFAULT_PROJECT_INDEX_EMBEDDING_MODEL,
    projectIndexEmbeddingApiKey:
      toTrimmedString(value.projectIndexEmbeddingApiKey) ??
      fallback.projectIndexEmbeddingApiKey ??
      "",
    projectIndexEmbeddingTimeoutMs: clampInt(
      toFiniteNumber(value.projectIndexEmbeddingTimeoutMs) ??
        fallback.projectIndexEmbeddingTimeoutMs,
      1000,
      30_000
    ),
    acpPromptMetaPolicy:
      toPromptMetaPolicy(value.acpPromptMetaPolicy) ??
      fallback.acpPromptMetaPolicy,
    acpPromptMetaAllowlist:
      toPromptMetaAllowlist(value.acpPromptMetaAllowlist) ??
      fallback.acpPromptMetaAllowlist,
  };

  return AppConfigSchema.parse(next);
}

function isSameConfig(left: AppConfig, right: AppConfig): boolean {
  return APP_CONFIG_KEYS.every((key) => {
    if (key !== "acpPromptMetaAllowlist" && key !== "supervisorToolAllowlist") {
      return left[key] === right[key];
    }
    if (left[key].length !== right[key].length) {
      return false;
    }
    for (let index = 0; index < left[key].length; index += 1) {
      if (left[key][index] !== right[key][index]) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Build the runtime app-config defaults from validated environment config.
 *
 * Invariant: values are clamped to hard server limits before becoming fallback
 * policy for sessions, logs, prompts, and ACP metadata.
 */
export function createDefaultAppConfigFromEnv(): AppConfig {
  return AppConfigSchema.parse({
    sessionIdleTimeoutMs: clampInt(
      ENV.sessionIdleTimeoutMs,
      1,
      MAX_SESSION_IDLE_TIMEOUT_MS
    ),
    sessionListPageMaxLimit: clampInt(
      ENV.sessionListPageMaxLimit,
      1,
      HARD_MAX_SESSION_LIST_PAGE_LIMIT
    ),
    sessionMessagesPageMaxLimit: clampInt(
      ENV.sessionMessagesPageMaxLimit,
      1,
      HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT
    ),
    logLevel: ENV.logLevel,
    maxTokens: clampInt(ENV.maxTokens, 1, HARD_MAX_APP_MAX_TOKENS),
    defaultModel: (ENV.defaultModel ?? "").trim(),
    supervisorEnabled: ENV.supervisorEnabled,
    supervisorModel: ENV.supervisorModel.trim(),
    supervisorMiniMaxApiKey: ENV.supervisorMiniMaxApiKey.trim(),
    supervisorDecisionTimeoutMs:
      ENV.supervisorDecisionTimeoutMs ?? DEFAULT_SUPERVISOR_DECISION_TIMEOUT_MS,
    supervisorDecisionMaxAttempts:
      ENV.supervisorDecisionMaxAttempts ??
      DEFAULT_SUPERVISOR_DECISION_MAX_ATTEMPTS,
    supervisorMaxRuntimeMs:
      ENV.supervisorMaxRuntimeMs ?? DEFAULT_SUPERVISOR_MAX_RUNTIME_MS,
    supervisorMaxRepeatedPrompts:
      ENV.supervisorMaxRepeatedPrompts ??
      DEFAULT_SUPERVISOR_MAX_REPEATED_PROMPTS,
    supervisorCustomSystemPrompt: (
      ENV.supervisorCustomSystemPrompt ??
      DEFAULT_SUPERVISOR_CUSTOM_SYSTEM_PROMPT
    ).trim(),
    supervisorToolPolicy:
      ENV.supervisorToolPolicy ?? DEFAULT_SUPERVISOR_TOOL_POLICY,
    supervisorToolAllowlist: [
      ...(ENV.supervisorToolAllowlist ?? DEFAULT_SUPERVISOR_TOOL_ALLOWLIST),
    ],
    supervisorWebSearchProvider:
      ENV.supervisorWebSearchProvider ?? DEFAULT_SUPERVISOR_WEB_SEARCH_PROVIDER,
    supervisorWebSearchApiKey: (ENV.supervisorWebSearchApiKey ?? "").trim(),
    supervisorMemoryProvider:
      ENV.supervisorMemoryProvider ?? DEFAULT_SUPERVISOR_MEMORY_PROVIDER,
    supervisorObsidianCommand: (
      ENV.supervisorObsidianCommand ?? DEFAULT_SUPERVISOR_OBSIDIAN_COMMAND
    ).trim(),
    supervisorObsidianVault: (ENV.supervisorObsidianVault ?? "").trim(),
    supervisorObsidianBlueprintPath: (
      ENV.supervisorObsidianBlueprintPath ?? ""
    ).trim(),
    supervisorObsidianLogPath: (ENV.supervisorObsidianLogPath ?? "").trim(),
    supervisorObsidianSearchPath: (
      ENV.supervisorObsidianSearchPath ??
      DEFAULT_SUPERVISOR_OBSIDIAN_SEARCH_PATH
    ).trim(),
    supervisorObsidianSearchLimit:
      ENV.supervisorObsidianSearchLimit ??
      DEFAULT_SUPERVISOR_OBSIDIAN_SEARCH_LIMIT,
    supervisorObsidianTimeoutMs:
      ENV.supervisorObsidianTimeoutMs ?? DEFAULT_SUPERVISOR_OBSIDIAN_TIMEOUT_MS,
    projectIndexEmbeddingEndpoint: (
      ENV.projectIndexEmbeddingEndpoint ?? ""
    ).trim(),
    projectIndexEmbeddingModel: (
      ENV.projectIndexEmbeddingModel ?? DEFAULT_PROJECT_INDEX_EMBEDDING_MODEL
    ).trim(),
    projectIndexEmbeddingApiKey: (ENV.projectIndexEmbeddingApiKey ?? "").trim(),
    projectIndexEmbeddingTimeoutMs: ENV.projectIndexEmbeddingTimeoutMs,
    acpPromptMetaPolicy: DEFAULT_ACP_PROMPT_META_POLICY,
    acpPromptMetaAllowlist: [...DEFAULT_ACP_PROMPT_META_ALLOWLIST],
  });
}

/**
 * Normalize unknown persisted app config into a complete runtime config.
 *
 * Error mode: invalid fields fall back through schema normalization rather than
 * leaking raw persisted settings into runtime policy.
 */
export function normalizeAppConfig(
  value: unknown,
  fallback: AppConfig
): AppConfig {
  return normalizeFromUnknown(value, fallback);
}

type AppConfigListener = (config: AppConfig) => void;

/**
 * In-memory runtime app configuration service.
 *
 * Invariant: snapshots returned by `getConfig` and `getDefaults` are immutable
 * normalized configs; updates notify subscribers only after validation succeeds.
 */
export class AppConfigService {
  private readonly defaults: AppConfig;
  private current: AppConfig;
  private readonly listeners = new Set<AppConfigListener>();

  constructor(initialConfig: AppConfig, defaults?: AppConfig) {
    this.defaults = Object.freeze({
      ...(defaults ?? initialConfig),
      acpPromptMetaAllowlist: [
        ...(defaults ?? initialConfig).acpPromptMetaAllowlist,
      ],
      supervisorToolAllowlist: [
        ...(defaults ?? initialConfig).supervisorToolAllowlist,
      ],
    });
    this.current = Object.freeze({
      ...initialConfig,
      acpPromptMetaAllowlist: [...initialConfig.acpPromptMetaAllowlist],
      supervisorToolAllowlist: [...initialConfig.supervisorToolAllowlist],
    });
  }

  static async create(
    settingsRepo: SettingsRepositoryPort
  ): Promise<AppConfigService> {
    const defaults = createDefaultAppConfigFromEnv();
    try {
      const settings = await settingsRepo.get();
      const initial = normalizeAppConfig(settings.app, defaults);
      return new AppConfigService(initial, defaults);
    } catch {
      return new AppConfigService(defaults, defaults);
    }
  }

  getConfig(): AppConfig {
    return this.current;
  }

  getDefaults(): AppConfig {
    return this.defaults;
  }

  subscribe(listener: AppConfigListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  validatePatch(patch: Partial<AppConfig>): AppConfig {
    const parsedPatch = AppConfigPatchSchema.parse(patch);
    return AppConfigSchema.parse({
      ...this.current,
      ...parsedPatch,
    });
  }

  applyPatch(patch: Partial<AppConfig>): AppConfig {
    const next = this.validatePatch(patch);
    return this.replace(next);
  }

  reloadFromSettings(settings: Pick<Settings, "app">): AppConfig {
    const next = normalizeAppConfig(settings.app, this.defaults);
    return this.replace(next);
  }

  private replace(next: AppConfig): AppConfig {
    if (isSameConfig(this.current, next)) {
      return this.current;
    }
    const frozen = Object.freeze({
      ...next,
      acpPromptMetaAllowlist: [...next.acpPromptMetaAllowlist],
      supervisorToolAllowlist: [...next.supervisorToolAllowlist],
    });
    this.current = frozen;
    for (const listener of this.listeners) {
      listener(frozen);
    }
    return frozen;
  }
}
