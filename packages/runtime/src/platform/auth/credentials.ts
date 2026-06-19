import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { ENV } from "../../config/environment";
import { createLogger } from "../logging/structured-logger";
import { getAuthStorageFile } from "./paths";

export interface AdminCredentials {
  username: string;
  password: string;
  email: string;
  createdAt: string;
  source: "env" | "file" | "generated";
}

const DEFAULT_USERNAME = "admin";
const DEFAULT_EMAIL_DOMAIN = "localhost.local";
const AUTH_FILE_PRIVATE_MODE = 0o600;
const logger = createLogger("Auth");

function getRuntimeAuthEnvValue(
  key: "AUTH_ADMIN_USERNAME" | "AUTH_ADMIN_EMAIL" | "AUTH_ADMIN_PASSWORD",
  fallback: string | undefined
): string | undefined {
  const runtimeValue = process.env[key]?.trim();
  if (runtimeValue && runtimeValue.length > 0) {
    return runtimeValue;
  }
  if (fallback && fallback.trim().length > 0) {
    return fallback.trim();
  }
  return undefined;
}

export function getOrCreateAdminCredentials(): AdminCredentials {
  const username =
    getRuntimeAuthEnvValue("AUTH_ADMIN_USERNAME", ENV.authAdminUsername) ??
    DEFAULT_USERNAME;
  const email =
    getRuntimeAuthEnvValue("AUTH_ADMIN_EMAIL", ENV.authAdminEmail) ??
    `${username}@${DEFAULT_EMAIL_DOMAIN}`;
  const password = getRuntimeAuthEnvValue(
    "AUTH_ADMIN_PASSWORD",
    ENV.authAdminPassword
  );

  if (password) {
    return {
      username,
      email,
      password,
      createdAt: new Date().toISOString(),
      source: "env",
    };
  }

  const credentialsPath = getAuthStorageFile("admin.credentials.json");
  if (existsSync(credentialsPath)) {
    try {
      const raw = readFileSync(credentialsPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<AdminCredentials>;
      if (parsed.username && parsed.password && parsed.email) {
        return {
          username: parsed.username,
          password: parsed.password,
          email: parsed.email,
          createdAt: parsed.createdAt ?? new Date().toISOString(),
          source: "file",
        };
      }
    } catch (error) {
      logger.warn("Failed to read admin.credentials.json", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const generated = randomBytes(18).toString("hex");
  const credentials: AdminCredentials = {
    username,
    password: generated,
    email,
    createdAt: new Date().toISOString(),
    source: "generated",
  };

  writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), {
    encoding: "utf-8",
    mode: AUTH_FILE_PRIVATE_MODE,
  });
  chmodSync(credentialsPath, AUTH_FILE_PRIVATE_MODE);
  logger.warn(
    `Plaintext admin credentials stored at ${credentialsPath}. Consider using AUTH_ADMIN_PASSWORD env var and deleting this file after initial setup.`
  );
  return credentials;
}
