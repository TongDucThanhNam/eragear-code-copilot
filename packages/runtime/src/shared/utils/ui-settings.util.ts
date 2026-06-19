import {
  AppConfigSchema,
  UiSettingsSchema,
} from "#runtime/shared/contracts/settings.contract";
import type { Settings } from "../types/settings.types";

type FormDataRecord = Record<string, string | File | undefined>;

function parseFiniteNumber(
  key: string,
  rawValue: string,
  fallback: number
): number {
  const normalized = rawValue.trim();
  if (normalized.length === 0) {
    return fallback;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a finite number`);
  }
  return parsed;
}

function parseFiniteInt(
  key: string,
  rawValue: string,
  fallback: number
): number {
  return Math.trunc(parseFiniteNumber(key, rawValue, fallback));
}

function parseBoolean(
  key: string,
  rawValue: string,
  fallback: boolean
): boolean {
  const normalized = rawValue.trim().toLowerCase();
  if (normalized.length === 0) {
    return fallback;
  }
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  throw new Error(`${key} must be a boolean`);
}

export function parseUiSettingsForm(
  formData: FormDataRecord,
  currentSettings: Settings
) {
  const getString = (key: string): string => {
    const value = formData[key];
    return typeof value === "string" ? value : "";
  };

  const ui = UiSettingsSchema.parse({
    theme: getString("ui.theme") || currentSettings.ui.theme,
    accentColor: getString("ui.accentColor") || currentSettings.ui.accentColor,
    density: getString("ui.density") || currentSettings.ui.density,
    fontScale: parseFiniteNumber(
      "ui.fontScale",
      getString("ui.fontScale"),
      currentSettings.ui.fontScale
    ),
    showReasoning: parseBoolean(
      "ui.showReasoning",
      getString("ui.showReasoning"),
      currentSettings.ui.showReasoning
    ),
  });

  const projectRoots: string[] = [];
  let hasExplicitRoots = false;
  const newRoot = getString("newRoot").trim();
  const removeRoot = getString("removeRoot").trim();

  for (const key of Object.keys(formData)) {
    if (key.startsWith("projectRoots[")) {
      const value = formData[key];
      if (typeof value === "string") {
        projectRoots.push(value);
        hasExplicitRoots = true;
      }
    }
  }

  if (!hasExplicitRoots) {
    projectRoots.push(...currentSettings.projectRoots);
  }

  if (newRoot && !removeRoot && !projectRoots.includes(newRoot)) {
    projectRoots.push(newRoot);
  }

  if (removeRoot) {
    const filtered = projectRoots.filter((root) => root !== removeRoot);
    projectRoots.length = 0;
    projectRoots.push(...filtered);
  }

  const rawLogLevel = getString("app.logLevel").trim().toLowerCase();
  const rawPromptMetaPolicy = getString("app.acpPromptMetaPolicy")
    .trim()
    .toLowerCase();
  const rawPromptMetaAllowlist = formData["app.acpPromptMetaAllowlist"];
  const app = AppConfigSchema.parse({
    sessionIdleTimeoutMs: parseFiniteInt(
      "app.sessionIdleTimeoutMs",
      getString("app.sessionIdleTimeoutMs"),
      currentSettings.app.sessionIdleTimeoutMs
    ),
    sessionListPageMaxLimit: parseFiniteInt(
      "app.sessionListPageMaxLimit",
      getString("app.sessionListPageMaxLimit"),
      currentSettings.app.sessionListPageMaxLimit
    ),
    sessionMessagesPageMaxLimit: parseFiniteInt(
      "app.sessionMessagesPageMaxLimit",
      getString("app.sessionMessagesPageMaxLimit"),
      currentSettings.app.sessionMessagesPageMaxLimit
    ),
    logLevel:
      rawLogLevel.length > 0 ? rawLogLevel : currentSettings.app.logLevel,
    maxTokens: parseFiniteInt(
      "app.maxTokens",
      getString("app.maxTokens"),
      currentSettings.app.maxTokens
    ),
    defaultModel: (() => {
      const rawValue = formData["app.defaultModel"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.defaultModel;
      }
      const normalized = rawValue.trim();
      return normalized.length > 0 ? normalized : "";
    })(),
    supervisorEnabled: parseBoolean(
      "app.supervisorEnabled",
      getString("app.supervisorEnabled"),
      currentSettings.app.supervisorEnabled
    ),
    supervisorModel: (() => {
      const rawValue = formData["app.supervisorModel"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.supervisorModel;
      }
      return rawValue.trim();
    })(),
    supervisorDeepSeekApiKey: (() => {
      const rawValue = formData["app.supervisorDeepSeekApiKey"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.supervisorDeepSeekApiKey;
      }
      return rawValue.trim();
    })(),
    supervisorDecisionTimeoutMs: parseFiniteInt(
      "app.supervisorDecisionTimeoutMs",
      getString("app.supervisorDecisionTimeoutMs"),
      currentSettings.app.supervisorDecisionTimeoutMs
    ),
    supervisorDecisionMaxAttempts: parseFiniteInt(
      "app.supervisorDecisionMaxAttempts",
      getString("app.supervisorDecisionMaxAttempts"),
      currentSettings.app.supervisorDecisionMaxAttempts
    ),
    supervisorMaxRuntimeMs: parseFiniteInt(
      "app.supervisorMaxRuntimeMs",
      getString("app.supervisorMaxRuntimeMs"),
      currentSettings.app.supervisorMaxRuntimeMs
    ),
    supervisorMaxRepeatedPrompts: parseFiniteInt(
      "app.supervisorMaxRepeatedPrompts",
      getString("app.supervisorMaxRepeatedPrompts"),
      currentSettings.app.supervisorMaxRepeatedPrompts
    ),
    supervisorWebSearchProvider: (() => {
      const rawValue = formData["app.supervisorWebSearchProvider"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.supervisorWebSearchProvider;
      }
      return rawValue.trim().toLowerCase();
    })(),
    supervisorWebSearchApiKey: (() => {
      const rawValue = formData["app.supervisorWebSearchApiKey"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.supervisorWebSearchApiKey;
      }
      return rawValue.trim();
    })(),
    supervisorMemoryProvider: (() => {
      const rawValue = formData["app.supervisorMemoryProvider"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.supervisorMemoryProvider;
      }
      return rawValue.trim().toLowerCase();
    })(),
    supervisorObsidianCommand: (() => {
      const rawValue = formData["app.supervisorObsidianCommand"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.supervisorObsidianCommand;
      }
      return rawValue.trim();
    })(),
    supervisorObsidianVault: (() => {
      const rawValue = formData["app.supervisorObsidianVault"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.supervisorObsidianVault;
      }
      return rawValue.trim();
    })(),
    supervisorObsidianBlueprintPath: (() => {
      const rawValue = formData["app.supervisorObsidianBlueprintPath"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.supervisorObsidianBlueprintPath;
      }
      return rawValue.trim();
    })(),
    supervisorObsidianLogPath: (() => {
      const rawValue = formData["app.supervisorObsidianLogPath"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.supervisorObsidianLogPath;
      }
      return rawValue.trim();
    })(),
    supervisorObsidianSearchPath: (() => {
      const rawValue = formData["app.supervisorObsidianSearchPath"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.supervisorObsidianSearchPath;
      }
      return rawValue.trim();
    })(),
    supervisorObsidianSearchLimit: parseFiniteInt(
      "app.supervisorObsidianSearchLimit",
      getString("app.supervisorObsidianSearchLimit"),
      currentSettings.app.supervisorObsidianSearchLimit
    ),
    supervisorObsidianTimeoutMs: parseFiniteInt(
      "app.supervisorObsidianTimeoutMs",
      getString("app.supervisorObsidianTimeoutMs"),
      currentSettings.app.supervisorObsidianTimeoutMs
    ),
    projectIndexEmbeddingEndpoint: (() => {
      const rawValue = formData["app.projectIndexEmbeddingEndpoint"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.projectIndexEmbeddingEndpoint;
      }
      return rawValue.trim();
    })(),
    projectIndexEmbeddingModel: (() => {
      const rawValue = formData["app.projectIndexEmbeddingModel"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.projectIndexEmbeddingModel;
      }
      return rawValue.trim();
    })(),
    projectIndexEmbeddingApiKey: (() => {
      const rawValue = formData["app.projectIndexEmbeddingApiKey"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.projectIndexEmbeddingApiKey;
      }
      return rawValue.trim();
    })(),
    projectIndexEmbeddingTimeoutMs: parseFiniteInt(
      "app.projectIndexEmbeddingTimeoutMs",
      getString("app.projectIndexEmbeddingTimeoutMs"),
      currentSettings.app.projectIndexEmbeddingTimeoutMs
    ),
    acpPromptMetaPolicy:
      rawPromptMetaPolicy.length > 0
        ? rawPromptMetaPolicy
        : currentSettings.app.acpPromptMetaPolicy,
    acpPromptMetaAllowlist: (() => {
      if (typeof rawPromptMetaAllowlist !== "string") {
        return currentSettings.app.acpPromptMetaAllowlist;
      }
      return [
        ...new Set(
          rawPromptMetaAllowlist
            .split(/[,\n]/g)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        ),
      ];
    })(),
  });

  return { ui, projectRoots, app };
}
