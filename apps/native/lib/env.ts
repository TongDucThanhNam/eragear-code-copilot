export function getWsUrl(): string {
  const envWsUrl = process.env.EXPO_PUBLIC_WS_URL;

  if (!envWsUrl) {
    console.warn("[env] EXPO_PUBLIC_WS_URL not set, using default");
  } else if (!isLocalDevUrl(envWsUrl)) {
    return envWsUrl;
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

  return envHttpUrl || "http://localhost:3000";
}

const LOCAL_DEV_URL_REGEX = /localhost|127\.0\.0\.1|10\.0\.2\.2/;

function isLocalDevUrl(url: string): boolean {
  return LOCAL_DEV_URL_REGEX.test(url);
}
