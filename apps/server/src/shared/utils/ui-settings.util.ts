import {
  AppConfigSchema,
  UiSettingsSchema,
} from "@/shared/contracts/settings.contract";
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
