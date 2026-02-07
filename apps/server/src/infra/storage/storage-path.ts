import {
  accessSync,
  existsSync,
  constants as fsConstants,
  mkdirSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
    storageDir = resolved;
    return resolved;
  }

  const candidates = getDefaultStorageCandidates();
  for (const candidate of candidates) {
    if (ensureWritableDirectorySync(candidate)) {
      storageDir = candidate;
      return candidate;
    }
  }

  throw new Error(
    `[Storage] No writable storage directory available. Tried: ${candidates.join(
      ", "
    )}`
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
