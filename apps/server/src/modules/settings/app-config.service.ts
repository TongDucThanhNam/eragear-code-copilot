import { z } from "zod";
import {
  HARD_MAX_APP_MAX_TOKENS,
  HARD_MAX_SESSION_LIST_PAGE_LIMIT,
  HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT,
  MAX_APP_DEFAULT_MODEL_LENGTH,
} from "@/config/constants";
import { ENV } from "@/config/environment";
import { LOG_LEVELS, type LogLevel } from "@/shared/types/log.types";
import type { AppConfig, Settings } from "@/shared/types/settings.types";
import { isRecord } from "@/shared/utils/type-guards.util";
import type { SettingsRepositoryPort } from "./application/ports/settings-repository.port";

const MAX_SESSION_IDLE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;

export const APP_CONFIG_KEYS = [
  "sessionIdleTimeoutMs",
  "sessionListPageMaxLimit",
  "sessionMessagesPageMaxLimit",
  "logLevel",
  "maxTokens",
  "defaultModel",
] as const;

export type AppConfigKey = (typeof APP_CONFIG_KEYS)[number];

export const AppConfigSchema = z.object({
  sessionIdleTimeoutMs: z
    .number()
    .int()
    .min(1)
    .max(MAX_SESSION_IDLE_TIMEOUT_MS),
  sessionListPageMaxLimit: z
    .number()
    .int()
    .min(1)
    .max(HARD_MAX_SESSION_LIST_PAGE_LIMIT),
  sessionMessagesPageMaxLimit: z
    .number()
    .int()
    .min(1)
    .max(HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT),
  logLevel: z.enum(LOG_LEVELS),
  maxTokens: z.number().int().min(1).max(HARD_MAX_APP_MAX_TOKENS),
  defaultModel: z.string().trim().max(MAX_APP_DEFAULT_MODEL_LENGTH),
});

const AppConfigPatchSchema = AppConfigSchema.partial();

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
  };

  return AppConfigSchema.parse(next);
}

function isSameConfig(left: AppConfig, right: AppConfig): boolean {
  return APP_CONFIG_KEYS.every((key) => left[key] === right[key]);
}

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
  });
}

export function normalizeAppConfig(
  value: unknown,
  fallback: AppConfig
): AppConfig {
  return normalizeFromUnknown(value, fallback);
}

type AppConfigListener = (config: AppConfig) => void;

export class AppConfigService {
  private readonly defaults: AppConfig;
  private current: AppConfig;
  private readonly listeners = new Set<AppConfigListener>();

  constructor(initialConfig: AppConfig, defaults?: AppConfig) {
    this.defaults = Object.freeze({ ...(defaults ?? initialConfig) });
    this.current = Object.freeze({ ...initialConfig });
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
    const frozen = Object.freeze({ ...next });
    this.current = frozen;
    for (const listener of this.listeners) {
      listener(frozen);
    }
    return frozen;
  }
}
