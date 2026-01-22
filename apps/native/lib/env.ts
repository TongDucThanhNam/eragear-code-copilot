import { Platform } from "react-native";

/**
 * Get the WebSocket URL for tRPC based on the environment
 * - Android Emulator: 10.0.2.2 (special IP for host machine)
 * - iOS Simulator: localhost
 * - Physical Device: LAN IP (from env var or config)
 */
export function getWsUrl(): string {
  const envWsUrl = process.env.EXPO_PUBLIC_WS_URL;

  if (!envWsUrl) {
    console.warn("[env] EXPO_PUBLIC_WS_URL not set, using default");
  } else if (!isLocalDevUrl(envWsUrl)) {
    return envWsUrl;
  }

  // For development, auto-detect platform-specific URL
  if (__DEV__) {
    const port = extractPort(envWsUrl) || 3000;

    if (Platform.OS === "android") {
      // Android Emulator uses 10.0.2.2 to reach host
      return `ws://10.0.2.2:${port}`;
    }

    if (Platform.OS === "ios") {
      // iOS Simulator can use localhost
      return `ws://localhost:${port}`;
    }
  }

  // For physical devices or production, use the configured URL
  return envWsUrl || "ws://localhost:3000";
}

/**
 * Get the HTTP URL for REST APIs
 */
export function getHttpUrl(): string {
  const envHttpUrl = process.env.EXPO_PUBLIC_SERVER_URL;

  if (!envHttpUrl) {
    console.warn("[env] EXPO_PUBLIC_SERVER_URL not set, using default");
  } else if (!isLocalDevUrl(envHttpUrl)) {
    return envHttpUrl;
  }

  if (__DEV__) {
    const port = extractPort(envHttpUrl) || 3000;

    if (Platform.OS === "android") {
      return `http://10.0.2.2:${port}`;
    }

    if (Platform.OS === "ios") {
      return `http://localhost:${port}`;
    }
  }

  return envHttpUrl || "http://localhost:3000";
}

function extractPort(url: string | undefined): number | null {
  if (!url) return null;
  const match = url.match(/:(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function isLocalDevUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1|10\.0\.2\.2/.test(url);
}
