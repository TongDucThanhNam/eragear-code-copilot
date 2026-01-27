import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ENV } from "../../config/environment";

const AUTH_DIR_NAME = "Eragear";

function getPlatformConfigDir(): string {
  if (process.platform === "win32") {
    return (
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming")
    );
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }

  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
}

function resolveAuthStorageDir(): string {
  if (ENV.authDbPath) {
    const resolved = path.isAbsolute(ENV.authDbPath)
      ? ENV.authDbPath
      : path.resolve(process.cwd(), ENV.authDbPath);
    return path.dirname(resolved);
  }

  const base = getPlatformConfigDir();
  return path.join(base, AUTH_DIR_NAME);
}

export function ensureAuthStorageDir(): string {
  const dir = resolveAuthStorageDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getAuthStorageFile(filename: string): string {
  return path.join(ensureAuthStorageDir(), filename);
}

export function getAuthDbPath(): string {
  if (ENV.authDbPath) {
    return path.isAbsolute(ENV.authDbPath)
      ? ENV.authDbPath
      : path.resolve(process.cwd(), ENV.authDbPath);
  }

  return getAuthStorageFile("auth.sqlite");
}
