export function rendererOrigin(rendererUrl: string): string {
  try {
    return new URL(rendererUrl).origin;
  } catch {
    return "http://127.0.0.1:3001";
  }
}

export function rendererWebSocketOrigin(rendererUrl: string): string {
  try {
    const url = new URL(rendererUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.origin;
  } catch {
    return "ws://127.0.0.1:3001";
  }
}

export function createRendererContentSecurityPolicy(input: {
  appIsPackaged: boolean;
  rendererUrl: string;
}): string {
  const origin = rendererOrigin(input.rendererUrl);
  const wsOrigin = rendererWebSocketOrigin(input.rendererUrl);
  const scriptPolicy = input.appIsPackaged
    ? "'self'"
    : `'self' 'unsafe-eval' 'unsafe-inline' ${origin}`;
  const connectPolicy = input.appIsPackaged
    ? "'self'"
    : `'self' ${origin} ${wsOrigin}`;
  return [
    "default-src 'self'",
    `script-src ${scriptPolicy}`,
    `connect-src ${connectPolicy}`,
    "frame-src 'self' http: https: file: data: blob:",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function withRendererContentSecurityPolicyHeaders(
  responseHeaders: Record<string, string[] | string | undefined>,
  csp: string
): Record<string, string[] | string> {
  const headers: Record<string, string[] | string> = {};

  for (const [key, value] of Object.entries(responseHeaders)) {
    if (key.toLowerCase() === "content-security-policy") {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    headers[key] = value;
  }

  headers["Content-Security-Policy"] = [csp];
  return headers;
}
