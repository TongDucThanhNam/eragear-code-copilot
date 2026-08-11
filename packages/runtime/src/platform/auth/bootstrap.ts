import {
  chmodSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { getMigrations } from "better-auth/db";
import { createLogger } from "../logging/structured-logger";
import type { AuthRuntime } from "./auth";
import { getOrCreateAdminCredentials } from "./credentials";
import { getAuthStorageFile } from "./paths";

const logger = createLogger("Auth");
const AUTH_FILE_PRIVATE_MODE = 0o600;

type AuthBootstrapTable = "user" | "apikey";

export interface AuthBootstrapPolicy {
  authBootstrapApiKey: boolean;
  authApiKeyPrefix: string | undefined;
}

function getTableCount(
  runtime: AuthRuntime,
  table: AuthBootstrapTable
): number {
  try {
    const row = runtime.authDb
      .prepare(`SELECT COUNT(*) as count FROM "${table}"`)
      .get() as { count?: number } | undefined;
    const count = row?.count ?? 0;
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

async function ensureMigrations(runtime: AuthRuntime): Promise<void> {
  const { toBeAdded, toBeCreated, runMigrations } = await getMigrations(
    runtime.authMigrationConfig
  );

  if (toBeAdded.length === 0 && toBeCreated.length === 0) {
    return;
  }

  logger.info("Running auth migrations", {
    createCount: toBeCreated.length,
    addCount: toBeAdded.length,
  });
  await runMigrations();
}

async function ensureAdminUser(runtime: AuthRuntime): Promise<void> {
  const userCount = getTableCount(runtime, "user");
  runtime.authState.hasUsers = userCount > 0;

  if (runtime.authState.hasUsers) {
    return;
  }

  const credentials = getOrCreateAdminCredentials();
  runtime.authState.adminUsername = credentials.username;

  try {
    const result = await runtime.auth.api.signUpEmail({
      body: {
        name: "Administrator",
        email: credentials.email,
        password: credentials.password,
        username: credentials.username,
      },
    });

    runtime.authState.hasUsers = true;
    runtime.authState.adminUserId = result?.user?.id ?? null;

    if (credentials.source === "generated") {
      const credentialsPath = getAuthStorageFile("admin.credentials.json");
      logger.info("Admin credentials generated", {
        credentialsPath,
        username: credentials.username,
      });
    }
  } catch (error) {
    const fallbackCount = getTableCount(runtime, "user");
    runtime.authState.hasUsers = fallbackCount > 0;
    if (!runtime.authState.hasUsers) {
      logger.error("Failed to bootstrap admin user", error as Error);
    }
  }
}

function resolveAdminUserId(runtime: AuthRuntime): string | null {
  if (runtime.authState.adminUserId) {
    return runtime.authState.adminUserId;
  }

  const username = runtime.authState.adminUsername;
  try {
    if (username) {
      const row = runtime.authDb
        .prepare(
          'SELECT id FROM "user" WHERE username = ? ORDER BY createdAt ASC LIMIT 1'
        )
        .get(username) as { id?: string } | undefined;
      return row?.id ?? null;
    }

    const fallback = runtime.authDb
      .prepare('SELECT id FROM "user" ORDER BY createdAt ASC LIMIT 1')
      .get() as { id?: string } | undefined;
    return fallback?.id ?? null;
  } catch {
    return null;
  }
}

function readPersistedBootstrapApiKey(apiKeyPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(apiKeyPath, "utf8")) as {
      key?: unknown;
    };
    return typeof parsed.key === "string" && parsed.key.trim().length > 0
      ? parsed.key
      : null;
  } catch {
    return null;
  }
}

function writeBootstrapApiKey(apiKeyPath: string, key: string): void {
  const temporaryPath = `${apiKeyPath}.${process.pid}.${Date.now()}.tmp`;
  const payload = {
    key,
    createdAt: new Date().toISOString(),
  };

  try {
    writeFileSync(temporaryPath, JSON.stringify(payload, null, 2), {
      encoding: "utf-8",
      mode: AUTH_FILE_PRIVATE_MODE,
      flag: "wx",
    });
    chmodSync(temporaryPath, AUTH_FILE_PRIVATE_MODE);
    renameSync(temporaryPath, apiKeyPath);
    chmodSync(apiKeyPath, AUTH_FILE_PRIVATE_MODE);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export async function ensureBootstrapApiKey(
  runtime: AuthRuntime,
  policy: AuthBootstrapPolicy
): Promise<void> {
  if (!policy.authBootstrapApiKey) {
    return;
  }

  const apiKeyPath = getAuthStorageFile("api-key.json");
  const persistedKey = readPersistedBootstrapApiKey(apiKeyPath);
  if (persistedKey) {
    try {
      const verification = (await runtime.auth.api.verifyApiKey({
        body: { key: persistedKey },
      })) as { valid?: boolean; key?: { userId?: string } } | null | undefined;
      if (verification?.valid && verification.key?.userId) {
        runtime.authState.bootstrapApiKey = persistedKey;
        return;
      }
    } catch {
      // Treat verification failures as stale bootstrap credentials. The
      // replacement below leaves every existing database key untouched.
    }
  }

  const adminUserId = resolveAdminUserId(runtime);
  if (!adminUserId) {
    return;
  }

  try {
    const result = await runtime.auth.api.createApiKey({
      body: {
        name: "default",
        userId: adminUserId,
        prefix: policy.authApiKeyPrefix ?? "eg_",
      },
    });

    if (result?.key) {
      runtime.authState.bootstrapApiKey = result.key;
      writeBootstrapApiKey(apiKeyPath, result.key);
      logger.info("Bootstrap API key generated", { apiKeyPath });
      logger.warn(
        `Plaintext API key stored at ${apiKeyPath}. Consider saving the key elsewhere and deleting this file after initial setup.`
      );
    }
  } catch (error) {
    logger.warn("Failed to bootstrap API key", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function ensureAuthSetup(
  runtime: AuthRuntime,
  policy: AuthBootstrapPolicy
): Promise<void> {
  await ensureMigrations(runtime);
  await ensureAdminUser(runtime);
  await ensureBootstrapApiKey(runtime, policy);
}
