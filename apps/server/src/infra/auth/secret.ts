import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { ENV } from "../../config/environment";
import { getAuthStorageFile } from "./paths";

export function getAuthSecret(): string {
  if (ENV.authSecret && ENV.authSecret.length >= 32) {
    return ENV.authSecret;
  }

  const secretPath = getAuthStorageFile("auth.secret");
  if (existsSync(secretPath)) {
    const stored = readFileSync(secretPath, "utf-8").trim();
    if (stored.length >= 32) {
      return stored;
    }
  }

  const generated = randomBytes(32).toString("hex");
  writeFileSync(secretPath, generated, "utf-8");
  return generated;
}
