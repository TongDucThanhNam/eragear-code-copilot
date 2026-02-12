import type { Settings } from "../types/settings.types";
import { LOG_LEVELS, type LogLevel } from "../types/log.types";

type FormDataRecord = Record<string, string | File | undefined>;
const LOG_LEVEL_SET = new Set(LOG_LEVELS);

export function parseUiSettingsForm(
  formData: FormDataRecord,
  currentSettings: Settings
) {
  const getString = (key: string): string => {
    const value = formData[key];
    return typeof value === "string" ? value : "";
  };

  const ui = {
    theme: (getString("ui.theme") || currentSettings.ui.theme) as
      | "light"
      | "dark"
      | "system",
    accentColor: getString("ui.accentColor") || currentSettings.ui.accentColor,
    density: (getString("ui.density") || currentSettings.ui.density) as
      | "comfortable"
      | "compact",
    fontScale:
      Number.parseFloat(getString("ui.fontScale")) ||
      currentSettings.ui.fontScale,
  };

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

  const parsePositiveInt = (key: string, fallback: number): number => {
    const raw = getString(key).trim();
    if (raw.length === 0) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
    return Math.trunc(parsed);
  };

  const app = {
    sessionIdleTimeoutMs: parsePositiveInt(
      "app.sessionIdleTimeoutMs",
      currentSettings.app.sessionIdleTimeoutMs
    ),
    sessionListPageMaxLimit: parsePositiveInt(
      "app.sessionListPageMaxLimit",
      currentSettings.app.sessionListPageMaxLimit
    ),
    sessionMessagesPageMaxLimit: parsePositiveInt(
      "app.sessionMessagesPageMaxLimit",
      currentSettings.app.sessionMessagesPageMaxLimit
    ),
    logLevel: (() => {
      const raw = getString("app.logLevel").trim().toLowerCase();
      if (!raw) {
        return currentSettings.app.logLevel;
      }
      if (!LOG_LEVEL_SET.has(raw as LogLevel)) {
        throw new Error("app.logLevel must be one of debug,info,warn,error");
      }
      return raw as LogLevel;
    })(),
    maxTokens: parsePositiveInt("app.maxTokens", currentSettings.app.maxTokens),
    defaultModel: (() => {
      const rawValue = formData["app.defaultModel"];
      if (typeof rawValue !== "string") {
        return currentSettings.app.defaultModel;
      }
      const normalized = rawValue.trim();
      return normalized.length > 0 ? normalized : "";
    })(),
  };

  return { ui, projectRoots, app };
}
