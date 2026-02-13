import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { ENV } from "../../config/environment";
import { getAuthStorageFile } from "./paths";

const AUTH_FILE_PRIVATE_MODE = 0o600;
const MIN_SECRET_LENGTH = 32;

function isValidSecret(secret: string): boolean {
  return secret.trim().length >= MIN_SECRET_LENGTH;
}

function readPersistedSecret(secretPath: string): string | null {
  try {
    const stored = readFileSync(secretPath, "utf-8").trim();
    return isValidSecret(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function getAuthSecret(): string {
  if (ENV.authSecret && isValidSecret(ENV.authSecret)) {
    return ENV.authSecret;
  }

  const secretPath = getAuthStorageFile("auth.secret");
  const persisted = readPersistedSecret(secretPath);
  if (persisted) {
    return persisted;
  }

  const generated = randomBytes(MIN_SECRET_LENGTH).toString("hex");
  try {
    const fd = openSync(secretPath, "wx", AUTH_FILE_PRIVATE_MODE);
    try {
      writeFileSync(fd, generated, "utf-8");
    } finally {
      closeSync(fd);
    }
    chmodSync(secretPath, AUTH_FILE_PRIVATE_MODE);
    return generated;
  } catch (error) {
    const errorCode =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : null;
    if (errorCode !== "EEXIST") {
      throw error;
    }
  }

  const racedPersisted = readPersistedSecret(secretPath);
  if (racedPersisted) {
    return racedPersisted;
  }
  throw new Error(
    `[Auth] Failed to read or create auth secret at ${secretPath}. Manual intervention required.`
  );
}
