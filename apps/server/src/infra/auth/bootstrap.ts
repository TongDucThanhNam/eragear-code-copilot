import { writeFileSync } from "node:fs";
import { getMigrations } from "better-auth/db";
import { ENV } from "../../config/environment";
import { getAuthStorageFile } from "./paths";
import { auth, authConfig, authDb, authState } from "./auth";
import { getOrCreateAdminCredentials } from "./credentials";

function getTableCount(table: string): number {
  try {
    const row = authDb
      .prepare(`SELECT COUNT(*) as count FROM "${table}"`)
      .get() as { count?: number } | undefined;
    const count = row?.count ?? 0;
    return Number.isFinite(count) ? count : 0;
  } catch (error) {
    return 0;
  }
}

async function ensureMigrations(): Promise<void> {
  const { toBeAdded, toBeCreated, runMigrations } =
    await getMigrations(authConfig);

  if (toBeAdded.length === 0 && toBeCreated.length === 0) {
    return;
  }

  console.log(
    `[Auth] Running migrations (create=${toBeCreated.length}, add=${toBeAdded.length})`
  );
  await runMigrations();
}

async function ensureAdminUser(): Promise<void> {
  const userCount = getTableCount("user");
  authState.hasUsers = userCount > 0;

  if (authState.hasUsers) {
    return;
  }

  const credentials = getOrCreateAdminCredentials();
  authState.adminUsername = credentials.username;

  try {
    const result = await auth.api.signUpEmail({
      body: {
        name: "Administrator",
        email: credentials.email,
        password: credentials.password,
        username: credentials.username,
      },
    });

    authState.hasUsers = true;
    authState.adminUserId = result?.user?.id ?? null;

    if (credentials.source === "generated") {
      const credentialsPath = getAuthStorageFile("admin.credentials.json");
      console.log(
        `[Auth] Admin credentials generated at ${credentialsPath} (username: ${credentials.username}).`
      );
    }
  } catch (error) {
    const fallbackCount = getTableCount("user");
    authState.hasUsers = fallbackCount > 0;
    if (!authState.hasUsers) {
      console.error("[Auth] Failed to bootstrap admin user:", error);
    }
  }
}

function resolveAdminUserId(): string | null {
  if (authState.adminUserId) {
    return authState.adminUserId;
  }

  const username = authState.adminUsername;
  try {
    if (username) {
      const row = authDb
        .prepare(
          'SELECT id FROM "user" WHERE username = ? ORDER BY createdAt ASC LIMIT 1'
        )
        .get(username) as { id?: string } | undefined;
      return row?.id ?? null;
    }

    const fallback = authDb
      .prepare('SELECT id FROM "user" ORDER BY createdAt ASC LIMIT 1')
      .get() as { id?: string } | undefined;
    return fallback?.id ?? null;
  } catch (error) {
    return null;
  }
}

async function ensureBootstrapApiKey(): Promise<void> {
  if (!ENV.authBootstrapApiKey) {
    return;
  }

  const keyCount = getTableCount("apikey");
  if (keyCount > 0) {
    return;
  }

  const adminUserId = resolveAdminUserId();
  if (!adminUserId) {
    return;
  }

  try {
    const result = await auth.api.createApiKey({
      body: {
        name: "default",
        userId: adminUserId,
        prefix: ENV.authApiKeyPrefix ?? "eg_",
      },
    });

    if (result?.key) {
      authState.bootstrapApiKey = result.key;
      const apiKeyPath = getAuthStorageFile("api-key.json");
      const payload = {
        key: result.key,
        createdAt: new Date().toISOString(),
      };
      writeFileSync(apiKeyPath, JSON.stringify(payload, null, 2), "utf-8");
      console.log(`[Auth] API key generated at ${apiKeyPath}.`);
    }
  } catch (error) {
    console.warn("[Auth] Failed to bootstrap API key:", error);
  }
}

export async function ensureAuthSetup(): Promise<void> {
  await ensureMigrations();
  await ensureAdminUser();
  await ensureBootstrapApiKey();
}
