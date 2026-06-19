import { Database } from "bun:sqlite";
import { expo } from "@better-auth/expo";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { apiKey, multiSession, username } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { authSchema } from "./drizzle-schema";
import {
  type AuthOAuthProviderCredentialsMap,
  createAuthOAuthProviderDescriptors,
  createBetterAuthSocialProviders,
} from "./oauth-providers";
import { ensureAuthDbWritable } from "./paths";
import { getAuthSecret } from "./secret";

interface AuthState {
  hasUsers: boolean;
  adminUserId: string | null;
  adminUsername: string | null;
  bootstrapApiKey: string | null;
}

export interface AuthRuntimePolicy {
  authBaseUrl: string;
  authTrustedOrigins: string[];
  authApiKeyPrefix: string | undefined;
  authApiKeyRateLimitEnabled: boolean;
  authApiKeyRateLimitTimeWindowMs: number;
  authApiKeyRateLimitMaxRequests: number;
  oauthProviders: AuthOAuthProviderCredentialsMap;
}

export function createAuthRuntime(policy: AuthRuntimePolicy) {
  const authDbPath = ensureAuthDbWritable();
  const authDb = new Database(authDbPath);
  const authOrm = drizzle({ client: authDb, schema: authSchema });

  const authState: AuthState = {
    hasUsers: false,
    adminUserId: null,
    adminUsername: null,
    bootstrapApiKey: null,
  };
  const expoPlugin = expo() as BetterAuthPlugin;
  const socialProviders = createBetterAuthSocialProviders(
    policy.oauthProviders
  );
  const oauthProviderDescriptors = createAuthOAuthProviderDescriptors(
    policy.oauthProviders
  );

  const authConfig = {
    database: drizzleAdapter(authOrm, {
      provider: "sqlite",
      schema: authSchema,
    }),
    baseURL: policy.authBaseUrl,
    secret: getAuthSecret(),
    trustedOrigins: policy.authTrustedOrigins,
    emailAndPassword: {
      enabled: true,
    },
    ...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),
    plugins: [
      expoPlugin,
      username(),
      multiSession(),
      apiKey({
        apiKeyHeaders: ["x-api-key", "authorization"],
        defaultPrefix: policy.authApiKeyPrefix ?? "eg_",
        rateLimit: {
          enabled: policy.authApiKeyRateLimitEnabled,
          timeWindow: policy.authApiKeyRateLimitTimeWindowMs,
          maxRequests: policy.authApiKeyRateLimitMaxRequests,
        },
        enableSessionForAPIKeys: true,
      }),
    ],
  };

  const authMigrationConfig = {
    ...authConfig,
    database: authDb,
  };

  const auth = betterAuth(authConfig);

  return {
    authDbPath,
    authDb,
    authOrm,
    authState,
    authConfig,
    authMigrationConfig,
    oauthProviderDescriptors,
    auth,
  };
}

export type AuthRuntime = ReturnType<typeof createAuthRuntime>;
