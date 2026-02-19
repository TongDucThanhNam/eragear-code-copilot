interface ResolveAuthTrustedOriginsParams {
  configuredOrigins: string[];
  authBaseUrl: string;
  wsPort: number;
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
  if (!authTrustedOrigins.includes(params.authBaseUrl)) {
    authTrustedOrigins.unshift(params.authBaseUrl);
  }

  return authTrustedOrigins;
}
