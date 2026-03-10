import { expoClient } from "@better-auth/expo/client";
import { multiSessionClient, usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { useMemo } from "react";

import { toHttpUrl } from "@/lib/server-url";

const AUTH_PATH = "/api/auth";
const SESSION_REFETCH_INTERVAL_SECONDS = 60;

function getAppScheme(): string {
  const rawScheme = Constants.expoConfig?.scheme ?? Constants.platform?.scheme;
  const scheme = Array.isArray(rawScheme) ? rawScheme[0] : rawScheme;

  if (typeof scheme !== "string" || scheme.trim().length === 0) {
    throw new Error("Expo scheme is required to initialize Better Auth.");
  }

  return scheme.trim();
}

function sanitizeStoragePrefixSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

export function buildBetterAuthBaseUrl(serverUrl: string): string {
  return `${toHttpUrl(serverUrl).replace(/\/+$/, "")}${AUTH_PATH}`;
}

export function buildBetterAuthStoragePrefix(serverUrl: string): string {
  return [
    sanitizeStoragePrefixSegment(getAppScheme()),
    sanitizeStoragePrefixSegment(toHttpUrl(serverUrl)),
  ].join("_");
}

export function createBetterAuthClientForServer(serverUrl: string) {
  const scheme = getAppScheme();

  return createAuthClient({
    baseURL: buildBetterAuthBaseUrl(serverUrl),
    sessionOptions: {
      refetchInterval: SESSION_REFETCH_INTERVAL_SECONDS,
      refetchOnWindowFocus: true,
      refetchWhenOffline: false,
    },
    plugins: [
      usernameClient(),
      multiSessionClient(),
      expoClient({
        scheme,
        storagePrefix: buildBetterAuthStoragePrefix(serverUrl),
        storage: SecureStore,
      }),
    ],
  });
}

export function useBetterAuthClient(serverUrl: string) {
  return useMemo(() => createBetterAuthClientForServer(serverUrl), [serverUrl]);
}

export async function clearStoredBetterAuthSession(
  serverUrl: string
): Promise<void> {
  const storagePrefix = buildBetterAuthStoragePrefix(serverUrl);

  await Promise.allSettled([
    SecureStore.deleteItemAsync(`${storagePrefix}_cookie`),
    SecureStore.deleteItemAsync(`${storagePrefix}_session_data`),
  ]);
}

export type BetterAuthClient = ReturnType<typeof createBetterAuthClientForServer>;
