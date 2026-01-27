import { betterAuth } from "better-auth";
import { apiKey, multiSession, username } from "better-auth/plugins";
import { Database } from "bun:sqlite";
import { ENV } from "../../config/environment";
import { getAuthSecret } from "./secret";
import { getAuthDbPath } from "./paths";

const authDbPath = getAuthDbPath();
const authDb = new Database(authDbPath);

type AuthState = {
  hasUsers: boolean;
  adminUserId: string | null;
  adminUsername: string | null;
  bootstrapApiKey: string | null;
};

export const authState: AuthState = {
  hasUsers: false,
  adminUserId: null,
  adminUsername: null,
  bootstrapApiKey: null,
};

export const authConfig = {
  database: authDb,
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
    }),
  ],
};

export const auth = betterAuth(authConfig);
export { authDb, authDbPath };
