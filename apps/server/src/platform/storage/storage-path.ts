import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  realpathSync,
  statfsSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_CONFIG_DIR_NAME } from "@/config/app-identity";
import { getPlatformConfigDir } from "@/shared/utils/platform-path.util";
import {
  getRuntimePlatform,
  isWindows,
} from "@/shared/utils/runtime-platform.util";
import {
  KNOWN_NETWORK_FS_TYPES,
  STORAGE_LOCAL_FS_TYPES,
  WINDOWS_UNC_PATH_PREFIX,
} from "./storage.constants";

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
const STORAGE_ALLOW_UNKNOWN_FS_ENV_KEY = "STORAGE_ALLOW_UNKNOWN_FS";

const resolveRealPathSync =
  typeof realpathSync.native === "function"
    ? realpathSync.native
    : realpathSync;

let storageDir: string | null = null;
let storageResolution: {
  path: string;
  origin: "env" | "default";
} | null = null;
let localFsTypeAllowlistCache: Set<number> | null = null;
let storageFsTypeOverrideForTests: number | null = null;

interface StorageSafetyResult {
  safe: boolean;
  reason?: string;
  fsType?: number;
  resolvedPath: string;
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
  const platformDir = path.join(getPlatformConfigDir(), APP_CONFIG_DIR_NAME);
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

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function allowUnknownStorageFsType(): boolean {
  return isTruthyEnv(process.env[STORAGE_ALLOW_UNKNOWN_FS_ENV_KEY]);
}

function shouldAllowUnknownStorageFsType(): boolean {
  if (allowUnknownStorageFsType()) {
    return true;
  }
  // Node on Windows does not provide stable fs type identifiers across hosts.
  return isWindows();
}

function toFiniteFsType(rawType: number | bigint): number {
  const fsType = typeof rawType === "bigint" ? Number(rawType) : rawType;
  if (!Number.isFinite(fsType)) {
    throw new Error("[Storage] Invalid filesystem type returned by statfs");
  }
  return fsType;
}

function readFsTypeSync(dir: string): number {
  if (storageFsTypeOverrideForTests !== null) {
    return storageFsTypeOverrideForTests;
  }
  const stats = statfsSync(dir);
  return toFiniteFsType(stats.type);
}

function resolveStorageLocalFsTypeAllowlist(): Set<number> {
  if (localFsTypeAllowlistCache) {
    return new Set(localFsTypeAllowlistCache);
  }

  const allowlist = new Set(STORAGE_LOCAL_FS_TYPES[getRuntimePlatform()] ?? []);
  localFsTypeAllowlistCache = allowlist;
  return new Set(allowlist);
}

function resolveStorageSafety(dir: string): StorageSafetyResult {
  const resolved = path.resolve(dir);
  if (isWindows() && resolved.startsWith(WINDOWS_UNC_PATH_PREFIX)) {
    return {
      safe: false,
      reason: "unc_network_path",
      resolvedPath: resolved,
    };
  }

  let canonical = resolved;
  try {
    canonical = resolveRealPathSync(resolved);
  } catch {
    // Directory should already exist after writability checks; keep resolved path.
    canonical = resolved;
  }

  if (isWindows() && canonical.startsWith(WINDOWS_UNC_PATH_PREFIX)) {
    return {
      safe: false,
      reason: "unc_network_path",
      resolvedPath: canonical,
    };
  }

  let fsType: number;
  try {
    fsType = readFsTypeSync(canonical);
  } catch {
    return {
      safe: false,
      reason: "statfs_failed",
      resolvedPath: canonical,
    };
  }

  if (KNOWN_NETWORK_FS_TYPES.has(fsType)) {
    return {
      safe: false,
      reason: "unsupported_filesystem_type",
      fsType,
      resolvedPath: canonical,
    };
  }

  const localFsTypeAllowlist = resolveStorageLocalFsTypeAllowlist();
  if (localFsTypeAllowlist.has(fsType)) {
    return {
      safe: true,
      fsType,
      resolvedPath: canonical,
    };
  }

  if (shouldAllowUnknownStorageFsType()) {
    return {
      safe: true,
      fsType,
      resolvedPath: canonical,
    };
  }

  return {
    safe: false,
    reason: "unknown_filesystem_type",
    fsType,
    resolvedPath: canonical,
  };
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
    const safety = resolveStorageSafety(resolved);
    if (safety.safe) {
      storageDir = safety.resolvedPath;
      storageResolution = {
        path: safety.resolvedPath,
        origin: "env",
      };
      return safety.resolvedPath;
    }

    throw new Error(
      `[Storage] ${STORAGE_DIR_ENV_KEY} points to an unsafe path (${safety.reason}${typeof safety.fsType === "number" ? `, fsType=${safety.fsType}` : ""}): ${safety.resolvedPath}`
    );
  }

  const candidates = getDefaultStorageCandidates();
  const rejected: Array<{ candidate: string; reason: string }> = [];
  for (const candidate of candidates) {
    if (!ensureWritableDirectorySync(candidate)) {
      continue;
    }
    const safety = resolveStorageSafety(candidate);
    if (!safety.safe) {
      rejected.push({
        candidate: safety.resolvedPath,
        reason: `${safety.reason}${typeof safety.fsType === "number" ? `, fsType=${safety.fsType}` : ""}`,
      });
      continue;
    }
    storageDir = safety.resolvedPath;
    storageResolution = {
      path: safety.resolvedPath,
      origin: "default",
    };
    return safety.resolvedPath;
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
  mkdirSync(dir, { recursive: true });
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
  localFsTypeAllowlistCache = null;
  storageFsTypeOverrideForTests = null;
}

export function setStorageFsTypeOverrideForTests(fsType: number | null): void {
  storageFsTypeOverrideForTests = fsType;
  localFsTypeAllowlistCache = null;
}
