import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const logger = createLogger("Auth");

export function getOrCreateAdminCredentials(): AdminCredentials {
  const username = ENV.authAdminUsername ?? DEFAULT_USERNAME;
  const email = ENV.authAdminEmail ?? `${username}@${DEFAULT_EMAIL_DOMAIN}`;

  if (ENV.authAdminPassword) {
    return {
      username,
      email,
      password: ENV.authAdminPassword,
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

  writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), "utf-8");
  return credentials;
}
