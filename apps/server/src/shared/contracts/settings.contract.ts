import { z } from "zod";
import {
  HARD_MAX_APP_MAX_TOKENS,
  HARD_MAX_SESSION_LIST_PAGE_LIMIT,
  HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT,
  MAX_APP_DEFAULT_MODEL_LENGTH,
} from "@/config/constants";
import { LOG_LEVELS } from "@/shared/types/log.types";

const MAX_SESSION_IDLE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PROMPT_META_ALLOWLIST_ITEMS = 128;
const MAX_PROMPT_META_ALLOWLIST_ITEM_LENGTH = 256;
const ACP_PROMPT_META_POLICIES = [
  "allowlist",
  "always",
  "never",
] as const;

export const UiSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  accentColor: z.string().min(4),
  density: z.enum(["comfortable", "compact"]),
  fontScale: z.number().min(0.8).max(1.3),
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
  acpPromptMetaPolicy: z.enum(ACP_PROMPT_META_POLICIES),
  acpPromptMetaAllowlist: z
    .array(z.string().trim().min(1).max(MAX_PROMPT_META_ALLOWLIST_ITEM_LENGTH))
    .max(MAX_PROMPT_META_ALLOWLIST_ITEMS),
});

export const AppConfigPatchSchema = AppConfigSchema.partial();
