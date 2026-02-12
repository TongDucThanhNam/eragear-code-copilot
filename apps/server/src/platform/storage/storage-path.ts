import {
  accessSync,
  existsSync,
  constants as fsConstants,
  mkdirSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLogger } from "@/platform/logging/structured-logger";

const APP_DIR_NAME = "Eragear";
const SQLITE_FILE_NAME = "eragear.sqlite";
const LEGACY_STORAGE_DIR = path.join(process.cwd(), ".eragear");
const LEGACY_JSON_FILES = [
  "projects.json",
  "sessions.json",
  "agents.json",
  "ui-settings.json",
] as const;
const STORAGE_DIR_ENV_KEY = "ERAGEAR_STORAGE_DIR";

let storageDir: string | null = null;
let storageResolution: {
  path: string;
  origin: "env" | "default" | "fallback_from_network";
  rejectedPath?: string;
  reason?: string;
} | null = null;
const logger = createLogger("Storage");

function getPlatformConfigDir(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
}

function resolveStorageDirFromEnv(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function pathExistsSync(filePath: string): boolean {
  return existsSync(filePath);
}

function ensureWritableDirectorySync(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, fsConstants.R_OK);
    accessSync(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function hasStorageDataSync(dir: string): boolean {
  if (!pathExistsSync(dir)) {
    return false;
  }
  if (pathExistsSync(path.join(dir, SQLITE_FILE_NAME))) {
    return true;
  }
  return LEGACY_JSON_FILES.some((file) => pathExistsSync(path.join(dir, file)));
}

function getDefaultStorageCandidates(): string[] {
  const platformDir = path.join(getPlatformConfigDir(), APP_DIR_NAME);
  const platformHasData = hasStorageDataSync(platformDir);
  const legacyHasData = hasStorageDataSync(LEGACY_STORAGE_DIR);

  if (legacyHasData && !platformHasData) {
    return [LEGACY_STORAGE_DIR, platformDir];
  }
  if (platformHasData && !legacyHasData) {
    return [platformDir, LEGACY_STORAGE_DIR];
  }

  const platformExists = pathExistsSync(platformDir);
  const legacyExists = pathExistsSync(LEGACY_STORAGE_DIR);
  if (legacyExists && !platformExists) {
    return [LEGACY_STORAGE_DIR, platformDir];
  }
  return [platformDir, LEGACY_STORAGE_DIR];
}

function getSafeFallbackCandidates(excluded: string[]): string[] {
  const defaults = getDefaultStorageCandidates();
  const emergency = path.join(os.tmpdir(), APP_DIR_NAME);
  return [...new Set([...defaults, emergency])].filter(
    (candidate) => !excluded.includes(candidate)
  );
}

function detectStorageRiskReason(dir: string): string | undefined {
  const resolved = path.resolve(dir);
  const normalized = resolved.replace(/\\/g, "/").toLowerCase();

  if (resolved.startsWith("\\\\")) {
    return "unc_network_path";
  }
  if (normalized.includes("/gvfs/") || normalized.includes("/.gvfs/")) {
    return "gvfs_mount";
  }
  if (
    normalized.startsWith("/net/") ||
    normalized.startsWith("/nfs/") ||
    normalized.startsWith("/afs/")
  ) {
    return "network_mount";
  }
  return undefined;
}

function resolveSafeFallback(excluded: string[]): string | undefined {
  const candidates = getSafeFallbackCandidates(excluded);
  for (const candidate of candidates) {
    if (!ensureWritableDirectorySync(candidate)) {
      continue;
    }
    if (detectStorageRiskReason(candidate)) {
      continue;
    }
    return candidate;
  }
  return undefined;
}

export function getStorageDirPathSync(): string {
  if (storageDir) {
    return storageDir;
  }

  const configuredDir = process.env[STORAGE_DIR_ENV_KEY]?.trim();
  if (configuredDir) {
    const resolved = resolveStorageDirFromEnv(configuredDir);
    if (!ensureWritableDirectorySync(resolved)) {
      throw new Error(
        `[Storage] ${STORAGE_DIR_ENV_KEY} is not writable: ${resolved}`
      );
    }
    const riskReason = detectStorageRiskReason(resolved);
    if (!riskReason) {
      storageDir = resolved;
      storageResolution = {
        path: resolved,
        origin: "env",
      };
      return resolved;
    }

    const fallback = resolveSafeFallback([resolved]);
    if (!fallback) {
      throw new Error(
        `[Storage] ${STORAGE_DIR_ENV_KEY} points to a risky path (${riskReason}) and no safe local fallback is available: ${resolved}`
      );
    }

    logger.warn("Configured storage path rejected due risk; falling back", {
      envKey: STORAGE_DIR_ENV_KEY,
      rejectedPath: resolved,
      fallbackPath: fallback,
      reason: riskReason,
    });
    storageDir = fallback;
    storageResolution = {
      path: fallback,
      origin: "fallback_from_network",
      rejectedPath: resolved,
      reason: riskReason,
    };
    return fallback;
  }

  const candidates = getSafeFallbackCandidates([]);
  const rejected: Array<{ candidate: string; reason: string }> = [];
  for (const candidate of candidates) {
    if (!ensureWritableDirectorySync(candidate)) {
      continue;
    }
    const riskReason = detectStorageRiskReason(candidate);
    if (riskReason) {
      rejected.push({ candidate, reason: riskReason });
      continue;
    }
    storageDir = candidate;
    storageResolution = {
      path: candidate,
      origin: "default",
    };
    return candidate;
  }

  const rejectedText =
    rejected.length > 0
      ? ` Rejected risky candidates: ${rejected
          .map((entry) => `${entry.candidate} (${entry.reason})`)
          .join(", ")}.`
      : "";
  throw new Error(
    `[Storage] No writable safe storage directory available. Tried: ${candidates.join(
      ", "
    )}.${rejectedText}`
  );
}

export function getStorageDirPath(): Promise<string> {
  return Promise.resolve(getStorageDirPathSync());
}

export function ensureStorageDirSync(): void {
  const dir = getStorageDirPathSync();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export async function ensureStorageDir(): Promise<void> {
  await mkdir(getStorageDirPathSync(), { recursive: true });
}

export function getStorageFileSync(filename: string): string {
  return path.join(getStorageDirPathSync(), filename);
}

export function getStorageFile(filename: string): Promise<string> {
  return Promise.resolve(getStorageFileSync(filename));
}

export function getStoragePathResolutionInfo(): {
  path: string;
  origin: "env" | "default" | "fallback_from_network";
  rejectedPath?: string;
  reason?: string;
} | null {
  if (!storageResolution) {
    return null;
  }
  return { ...storageResolution };
}

export function resetStoragePathCacheForTests(): void {
  storageDir = null;
  storageResolution = null;
}
