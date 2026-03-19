import {
  buildTrpcWsUrl,
  getDefaultServerUrl,
  toHttpUrl,
} from "@/lib/server-url";
import { useAuthStore } from "@/store/auth-store";

// Get WS URL from auth store or environment
export function getWsUrl(): string {
  // Try to get from auth store first (user configured)
  try {
    const storeUrl = useAuthStore.getState().serverUrl;
    if (storeUrl && storeUrl.trim().length > 0) {
      return buildTrpcWsUrl(storeUrl.trim());
    }
  } catch {
    // Store not ready yet, fall back to env
  }

  // Fall back to environment variable
  const envWsUrl = process.env.EXPO_PUBLIC_WS_URL;

  if (envWsUrl) {
    return buildTrpcWsUrl(envWsUrl.trim());
  }
  console.warn("[env] EXPO_PUBLIC_WS_URL not set, using default");

  return buildTrpcWsUrl(getDefaultServerUrl());
}

/**
 * Get the HTTP URL for REST APIs
 */
export function getHttpUrl(): string {
  // Try to get from auth store first (user configured)
  try {
    const storeUrl = useAuthStore.getState().serverUrl;
    if (storeUrl && storeUrl.trim().length > 0) {
      return toHttpUrl(storeUrl.trim());
    }
  } catch {
    // Store not ready yet, fall back to env
  }

  // Fall back to environment variable
  const envHttpUrl = process.env.EXPO_PUBLIC_SERVER_URL;

  if (envHttpUrl) {
    return toHttpUrl(envHttpUrl.trim());
  }
  console.warn("[env] EXPO_PUBLIC_SERVER_URL not set, using default");

  return getDefaultServerUrl();
}
