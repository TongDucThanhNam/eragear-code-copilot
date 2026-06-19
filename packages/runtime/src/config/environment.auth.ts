interface ResolveAuthTrustedOriginsParams {
  configuredOrigins: string[];
  authBaseUrl: string;
  wsPort: number;
}

const NATIVE_APP_TRUSTED_ORIGINS = ["eragear-code-copilot://"] as const;
const EXPO_DEV_TRUSTED_ORIGIN_PREFIXES = ["exp://"] as const;

function isLocalDevAuthBaseUrl(authBaseUrl: string): boolean {
  try {
    const { hostname } = new URL(authBaseUrl);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

export function resolveAuthTrustedOrigins(
  params: ResolveAuthTrustedOriginsParams
): string[] {
  const authTrustedOrigins = [...params.configuredOrigins];
  if (authTrustedOrigins[0] === "*") {
    return authTrustedOrigins;
  }

  const defaultDevOrigins = [
    `http://localhost:${params.wsPort}`,
    `http://127.0.0.1:${params.wsPort}`,
    `http://0.0.0.0:${params.wsPort}`,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
  ];
  for (const origin of defaultDevOrigins) {
    if (!authTrustedOrigins.includes(origin)) {
      authTrustedOrigins.push(origin);
    }
  }
  for (const origin of NATIVE_APP_TRUSTED_ORIGINS) {
    if (!authTrustedOrigins.includes(origin)) {
      authTrustedOrigins.push(origin);
    }
  }
  if (isLocalDevAuthBaseUrl(params.authBaseUrl)) {
    for (const origin of EXPO_DEV_TRUSTED_ORIGIN_PREFIXES) {
      if (!authTrustedOrigins.includes(origin)) {
        authTrustedOrigins.push(origin);
      }
    }
  }
  if (!authTrustedOrigins.includes(params.authBaseUrl)) {
    authTrustedOrigins.unshift(params.authBaseUrl);
  }

  return authTrustedOrigins;
}
