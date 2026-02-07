import { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { apiKey, multiSession, username } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { ENV } from "../../config/environment";
import { authSchema } from "./drizzle-schema";
import { ensureAuthDbWritable } from "./paths";
import { getAuthSecret } from "./secret";

const authDbPath = ensureAuthDbWritable();
const authDb = new Database(authDbPath);
const authOrm = drizzle({ client: authDb, schema: authSchema });

interface AuthState {
  hasUsers: boolean;
  adminUserId: string | null;
  adminUsername: string | null;
  bootstrapApiKey: string | null;
}

export const authState: AuthState = {
  hasUsers: false,
  adminUserId: null,
  adminUsername: null,
  bootstrapApiKey: null,
};

export const authConfig = {
  database: drizzleAdapter(authOrm, {
    provider: "sqlite",
    schema: authSchema,
  }),
  baseURL: ENV.authBaseUrl,
  secret: getAuthSecret(),
  trustedOrigins: ENV.authTrustedOrigins,
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    username(),
    multiSession(),
    apiKey({
      apiKeyHeaders: ["x-api-key", "authorization"],
      defaultPrefix: ENV.authApiKeyPrefix ?? "eg_",
      rateLimit: {
        enabled: ENV.authApiKeyRateLimitEnabled,
        timeWindow: ENV.authApiKeyRateLimitTimeWindowMs,
        maxRequests: ENV.authApiKeyRateLimitMaxRequests,
      },
      enableSessionForAPIKeys: true,
    }),
  ],
};

export const authMigrationConfig = {
  ...authConfig,
  database: authDb,
};

export const auth = betterAuth(authConfig);
export { authDb, authDbPath, authOrm };
