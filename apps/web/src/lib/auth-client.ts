import { buildHttpApiUrl } from "@/lib/server-url";
import { multiSessionClient, usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export function createBetterAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    sessionOptions: {
      refetchInterval: 60,
      refetchOnWindowFocus: true,
      refetchWhenOffline: false,
    },
    plugins: [usernameClient(), multiSessionClient()],
  });
}

export function buildBetterAuthBaseUrl(serverUrl: string) {
  return buildHttpApiUrl(serverUrl, "/api/auth");
}

export function createBetterAuthClientForServer(serverUrl: string) {
  return createBetterAuthClient(buildBetterAuthBaseUrl(serverUrl));
}

export type BetterAuthClient = ReturnType<typeof createBetterAuthClient>;
