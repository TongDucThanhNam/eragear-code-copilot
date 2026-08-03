import { z } from "zod";
import {
  HARD_MAX_APP_MAX_TOKENS,
  HARD_MAX_SESSION_LIST_PAGE_LIMIT,
  HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT,
  MAX_APP_DEFAULT_MODEL_LENGTH,
} from "#runtime/config/constants";
import { LOG_LEVELS } from "#runtime/shared/types/log.types";

const MAX_SESSION_IDLE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PROMPT_META_ALLOWLIST_ITEMS = 128;
const MAX_PROMPT_META_ALLOWLIST_ITEM_LENGTH = 256;
const MAX_SUPERVISOR_MODEL_LENGTH = 128;
const MAX_SUPERVISOR_API_KEY_LENGTH = 2048;
const MAX_SUPERVISOR_COMMAND_LENGTH = 256;
const MAX_SUPERVISOR_PATH_LENGTH = 512;
const MAX_SUPERVISOR_CUSTOM_SYSTEM_PROMPT_LENGTH = 8000;
const MAX_SUPERVISOR_TOOL_ALLOWLIST_ITEMS = 64;
const MAX_SUPERVISOR_TOOL_ALLOWLIST_ITEM_LENGTH = 128;
const MAX_PROJECT_INDEX_EMBEDDING_ENDPOINT_LENGTH = 512;
const MAX_PROJECT_INDEX_EMBEDDING_MODEL_LENGTH = 128;
const MAX_PROJECT_INDEX_EMBEDDING_API_KEY_LENGTH = 2048;
const ACP_PROMPT_META_POLICIES = ["allowlist", "always", "never"] as const;
const SUPERVISOR_WEB_SEARCH_PROVIDERS = ["none", "exa"] as const;
const SUPERVISOR_MEMORY_PROVIDERS = ["none", "obsidian"] as const;
const SUPERVISOR_TOOL_POLICIES = ["builtin", "custom-allowlist"] as const;

export const UiSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  accentColor: z.string().min(4),
  density: z.enum(["comfortable", "compact"]),
  fontScale: z.number().min(0.8).max(1.3),
  showReasoning: z.boolean().default(true),
});

export const UiSettingsPatchSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  accentColor: z.string().min(4).optional(),
  density: z.enum(["comfortable", "compact"]).optional(),
  fontScale: z.number().min(0.8).max(1.3).optional(),
  showReasoning: z.boolean().optional(),
});

export const DEFAULT_UI_SETTINGS = UiSettingsSchema.parse({
  theme: "system",
  accentColor: "#2563eb",
  density: "comfortable",
  fontScale: 1,
  showReasoning: true,
});

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
  supervisorEnabled: z.boolean().default(false),
  supervisorModel: z
    .string()
    .trim()
    .max(MAX_SUPERVISOR_MODEL_LENGTH)
    .default(""),
  supervisorMiniMaxApiKey: z
    .string()
    .trim()
    .max(MAX_SUPERVISOR_API_KEY_LENGTH)
    .default(""),
  supervisorDecisionTimeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(120_000)
    .default(30_000),
  supervisorDecisionMaxAttempts: z.number().int().min(1).max(10).default(2),
  supervisorMaxRuntimeMs: z
    .number()
    .int()
    .min(1000)
    .max(24 * 60 * 60 * 1000)
    .default(30 * 60 * 1000),
  supervisorMaxRepeatedPrompts: z.number().int().min(1).max(200).default(20),
  supervisorCustomSystemPrompt: z
    .string()
    .trim()
    .max(MAX_SUPERVISOR_CUSTOM_SYSTEM_PROMPT_LENGTH)
    .default(""),
  supervisorToolPolicy: z.enum(SUPERVISOR_TOOL_POLICIES).default("builtin"),
  supervisorToolAllowlist: z
    .array(
      z.string().trim().min(1).max(MAX_SUPERVISOR_TOOL_ALLOWLIST_ITEM_LENGTH)
    )
    .max(MAX_SUPERVISOR_TOOL_ALLOWLIST_ITEMS)
    .default([]),
  supervisorWebSearchProvider: z
    .enum(SUPERVISOR_WEB_SEARCH_PROVIDERS)
    .default("none"),
  supervisorWebSearchApiKey: z
    .string()
    .trim()
    .max(MAX_SUPERVISOR_API_KEY_LENGTH)
    .default(""),
  supervisorMemoryProvider: z.enum(SUPERVISOR_MEMORY_PROVIDERS).default("none"),
  supervisorObsidianCommand: z
    .string()
    .trim()
    .max(MAX_SUPERVISOR_COMMAND_LENGTH)
    .default("obsidian"),
  supervisorObsidianVault: z
    .string()
    .trim()
    .max(MAX_SUPERVISOR_PATH_LENGTH)
    .default(""),
  supervisorObsidianBlueprintPath: z
    .string()
    .trim()
    .max(MAX_SUPERVISOR_PATH_LENGTH)
    .default(""),
  supervisorObsidianLogPath: z
    .string()
    .trim()
    .max(MAX_SUPERVISOR_PATH_LENGTH)
    .default(""),
  supervisorObsidianSearchPath: z
    .string()
    .trim()
    .max(MAX_SUPERVISOR_PATH_LENGTH)
    .default("Project"),
  supervisorObsidianSearchLimit: z.number().int().min(1).max(20).default(3),
  supervisorObsidianTimeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(60_000)
    .default(5000),
  projectIndexEmbeddingEndpoint: z
    .string()
    .trim()
    .max(MAX_PROJECT_INDEX_EMBEDDING_ENDPOINT_LENGTH)
    .default(""),
  projectIndexEmbeddingModel: z
    .string()
    .trim()
    .max(MAX_PROJECT_INDEX_EMBEDDING_MODEL_LENGTH)
    .default("text-embedding-3-small"),
  projectIndexEmbeddingApiKey: z
    .string()
    .trim()
    .max(MAX_PROJECT_INDEX_EMBEDDING_API_KEY_LENGTH)
    .default(""),
  projectIndexEmbeddingTimeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(30_000)
    .default(10_000),
  acpPromptMetaPolicy: z.enum(ACP_PROMPT_META_POLICIES),
  acpPromptMetaAllowlist: z
    .array(z.string().trim().min(1).max(MAX_PROMPT_META_ALLOWLIST_ITEM_LENGTH))
    .max(MAX_PROMPT_META_ALLOWLIST_ITEMS),
});

export const AppConfigPatchSchema = AppConfigSchema.partial();
