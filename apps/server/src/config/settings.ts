import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const STORAGE_DIR = path.join(process.cwd(), ".eragear");
const SETTINGS_FILE = path.join(STORAGE_DIR, "ui-settings.json");

const UiSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  accentColor: z.string().min(4),
  density: z.enum(["comfortable", "compact"]),
  fontScale: z.number().min(0.8).max(1.3),
});

const SettingsSchema = z.object({
  ui: UiSettingsSchema,
  projectRoots: z.array(z.string()).min(1).default([process.cwd()]),
});

const SettingsPatchSchema = z.object({
  ui: UiSettingsSchema.partial().optional(),
  projectRoots: z.array(z.string()).min(1).optional(),
});

export type UiSettings = z.infer<typeof UiSettingsSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

const DEFAULT_SETTINGS: Settings = {
  ui: {
    theme: "system",
    accentColor: "#2563eb",
    density: "comfortable",
    fontScale: 1,
  },
  projectRoots: [process.cwd()],
};

function ensureSettingsFile() {
  if (!existsSync(STORAGE_DIR)) {
    mkdirSync(STORAGE_DIR, { recursive: true });
  }
  if (!existsSync(SETTINGS_FILE)) {
    writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  }
}

export function getSettings(): Settings {
  ensureSettingsFile();
  const raw = readFileSync(SETTINGS_FILE, "utf-8");
  try {
    return SettingsSchema.parse(JSON.parse(raw));
  } catch {
    try {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      const uiResult = UiSettingsSchema.safeParse(parsed.ui);
      const projectRoots = Array.isArray(parsed.projectRoots)
        ? parsed.projectRoots
        : DEFAULT_SETTINGS.projectRoots;
      const next: Settings = {
        ui: uiResult.success ? uiResult.data : DEFAULT_SETTINGS.ui,
        projectRoots:
          projectRoots.length > 0
            ? projectRoots
            : DEFAULT_SETTINGS.projectRoots,
      };
      writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
      return next;
    } catch {
      writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
      return DEFAULT_SETTINGS;
    }
  }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const validated = SettingsPatchSchema.parse(patch);
  const current = getSettings();
  const next = {
    ...current,
    ...validated,
    ui: { ...current.ui, ...(validated.ui ?? {}) },
  };
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}
