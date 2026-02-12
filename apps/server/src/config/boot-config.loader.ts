import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isRecord } from "@/shared/utils/type-guards.util";

const BOOT_CONFIG_FILE_NAME = "settings.json";
const BOOT_CONFIG_PATH_ENV_KEY = "ERAGEAR_BOOT_CONFIG_PATH";

export type BootRuntimeMode = "standard" | "compiled";

export interface BootConfigLoadResult {
  values: Record<string, unknown>;
  sourcePath?: string;
  searchedPaths: string[];
  mode: BootRuntimeMode;
}

export function normalizeBootValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    if (
      value.some(
        (item) =>
          typeof item !== "string" &&
          (typeof item !== "number" || !Number.isFinite(item))
      )
    ) {
      return JSON.stringify(value);
    }
    const items = value
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }
        if (typeof item === "number" && Number.isFinite(item)) {
          return String(item);
        }
        return "";
      })
      .filter((item) => item.length > 0);
    if (items.length > 0) {
      return items.join(",");
    }
  }
  if (isRecord(value)) {
    return JSON.stringify(value);
  }
  return undefined;
}

function parseBootMode(
  values: Record<string, unknown>,
  sourcePath?: string
): BootRuntimeMode {
  const raw = values.mode;
  if (raw === undefined || raw === null) {
    return "standard";
  }
  if (typeof raw !== "string") {
    throw new Error(
      `[Config] Invalid boot.mode in ${sourcePath ?? "settings.json"}: expected string "standard" or "compiled".`
    );
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "standard" || normalized === "compiled") {
    return normalized;
  }
  throw new Error(
    `[Config] Invalid boot.mode "${raw}" in ${sourcePath ?? "settings.json"}: expected "standard" or "compiled".`
  );
}

function resolveBootConfigPath(): string | undefined {
  const explicit = process.env[BOOT_CONFIG_PATH_ENV_KEY]?.trim();
  if (explicit) {
    return path.isAbsolute(explicit)
      ? explicit
      : path.resolve(process.cwd(), explicit);
  }

  const candidates = listBootConfigSearchPaths();
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function listBootConfigSearchPaths(): string[] {
  return [
    path.resolve(path.dirname(process.execPath), BOOT_CONFIG_FILE_NAME),
    path.resolve(process.cwd(), BOOT_CONFIG_FILE_NAME),
    path.resolve(process.cwd(), ".eragear", BOOT_CONFIG_FILE_NAME),
  ];
}

export function loadBootConfigValues(): BootConfigLoadResult {
  const configPath = resolveBootConfigPath();
  const searchedPaths = listBootConfigSearchPaths();
  if (!configPath) {
    return { values: {}, searchedPaths, mode: "standard" };
  }

  let parsed: unknown;
  try {
    const raw = readFileSync(configPath, "utf8");
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `[Config] Failed to load boot config file at ${configPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      `[Config] Boot config file must be a JSON object: ${configPath}`
    );
  }

  const bootSection = parsed.boot;
  if (isRecord(bootSection)) {
    return {
      values: bootSection,
      sourcePath: configPath,
      searchedPaths,
      mode: parseBootMode(bootSection, configPath),
    };
  }

  return {
    values: parsed,
    sourcePath: configPath,
    searchedPaths,
    mode: parseBootMode(parsed, configPath),
  };
}

function hasBootValue(values: Record<string, unknown>, key: string): boolean {
  const normalized = normalizeBootValue(values[key]);
  return Boolean(normalized && normalized.trim().length > 0);
}

export function assertCompiledBootRequirements(
  config: BootConfigLoadResult
): void {
  const missing: string[] = [];
  if (
    !(
      hasBootValue(config.values, "WS_PORT") ||
      hasBootValue(config.values, "PORT")
    )
  ) {
    missing.push("WS_PORT or PORT");
  }
  if (
    !(
      hasBootValue(config.values, "WS_HOST") ||
      hasBootValue(config.values, "HOST")
    )
  ) {
    missing.push("WS_HOST or HOST");
  }
  const authSecrets = [normalizeBootValue(config.values.AUTH_SECRET)].filter(
    (value): value is string => Boolean(value && value.trim().length > 0)
  );
  if (authSecrets.length === 0) {
    missing.push("AUTH_SECRET");
  } else if (!authSecrets.some((secret) => secret.trim().length >= 32)) {
    missing.push("AUTH_SECRET (minimum 32 characters)");
  }
  if (!hasBootValue(config.values, "ALLOWED_AGENT_COMMAND_POLICIES")) {
    missing.push("ALLOWED_AGENT_COMMAND_POLICIES");
  }
  if (!hasBootValue(config.values, "ALLOWED_TERMINAL_COMMAND_POLICIES")) {
    missing.push("ALLOWED_TERMINAL_COMMAND_POLICIES");
  }
  if (!hasBootValue(config.values, "ALLOWED_ENV_KEYS")) {
    missing.push("ALLOWED_ENV_KEYS");
  }

  if (missing.length === 0) {
    return;
  }

  const sourceHint = config.sourcePath
    ? `Loaded boot config from: ${config.sourcePath}`
    : `No settings.json boot config found. Searched: ${config.searchedPaths.join(", ")}`;
  throw new Error(
    [
      "[Config] Missing required boot keys for compiled mode:",
      ...missing.map((key) => `- ${key}`),
      'Compiled mode ignores env var overrides. Configure these in settings.json under "boot".',
      sourceHint,
    ].join("\n")
  );
}
