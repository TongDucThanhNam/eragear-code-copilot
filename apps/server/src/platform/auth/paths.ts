import {
  accessSync,
  closeSync,
  existsSync,
  constants as fsConstants,
  mkdirSync,
  openSync,
} from "node:fs";
import path from "node:path";
import { APP_CONFIG_DIR_NAME } from "@/config/app-identity";
import { getPlatformConfigDir } from "@/shared/utils/platform-path.util";
import { ENV } from "../../config/environment";

function getAuthDbPathOverride(): string | undefined {
  const fromProcessEnv = process.env.AUTH_DB_PATH?.trim();
  if (fromProcessEnv && fromProcessEnv.length > 0) {
    return fromProcessEnv;
  }
  return ENV.authDbPath;
}

function resolveAuthStorageDir(): string {
  const authDbPath = getAuthDbPathOverride();
  if (authDbPath) {
    const resolved = path.isAbsolute(authDbPath)
      ? authDbPath
      : path.resolve(process.cwd(), authDbPath);
    return path.dirname(resolved);
  }

  const base = getPlatformConfigDir();
  return path.join(base, APP_CONFIG_DIR_NAME);
}

export function ensureAuthStorageDir(): string {
  const dir = resolveAuthStorageDir();
  mkdirSync(dir, { recursive: true });
  accessSync(dir, fsConstants.R_OK);
  accessSync(dir, fsConstants.W_OK);
  return dir;
}

export function getAuthStorageFile(filename: string): string {
  return path.join(ensureAuthStorageDir(), filename);
}

export function getAuthDbPath(): string {
  const authDbPath = getAuthDbPathOverride();
  if (authDbPath) {
    return path.isAbsolute(authDbPath)
      ? authDbPath
      : path.resolve(process.cwd(), authDbPath);
  }

  return getAuthStorageFile("auth.sqlite");
}

export function ensureAuthDbWritable(): string {
  const dbPath = getAuthDbPath();
  const dir = path.dirname(dbPath);
  mkdirSync(dir, { recursive: true });
  accessSync(dir, fsConstants.R_OK);
  accessSync(dir, fsConstants.W_OK);

  if (!existsSync(dbPath)) {
    const fd = openSync(dbPath, "a");
    closeSync(fd);
  }

  accessSync(dbPath, fsConstants.R_OK);
  accessSync(dbPath, fsConstants.W_OK);
  return dbPath;
}
