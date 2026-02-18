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
    "http://localhost:5173",
    "http://localhost:4173",
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
