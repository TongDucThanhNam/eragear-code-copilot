import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR_NAME = "Eragear";
const SQLITE_FILE_NAME = "eragear.sqlite";
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT_DIR = path.resolve(MODULE_DIR, "../../..");
const LEGACY_STORAGE_DIR = path.join(SERVER_ROOT_DIR, ".eragear");
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
  origin: "env" | "default";
} | null = null;

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
  return path.isAbsolute(value) ? value : path.resolve(SERVER_ROOT_DIR, value);
}

function pathExistsSync(filePath: string): boolean {
  return existsSync(filePath);
}

function ensureWritableDirectorySync(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    accessSync(dir, constants.X_OK);
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

    throw new Error(
      `[Storage] ${STORAGE_DIR_ENV_KEY} points to a risky path (${riskReason}): ${resolved}`
    );
  }

  const candidates = getDefaultStorageCandidates();
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
  origin: "env" | "default";
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
