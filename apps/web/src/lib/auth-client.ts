import { createAuthClient } from "better-auth/client";
import { apiKeyClient } from "better-auth/client/plugins";

export type BetterAuthClient = ReturnType<typeof createAuthClient>;

export function createBetterAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [apiKeyClient()],
  });
}
