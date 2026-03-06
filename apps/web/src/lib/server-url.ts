const FALLBACK_SERVER_URL = "ws://localhost:3010";
const PROTOCOL_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;
const TRPC_SUFFIX = "/trpc";

function withFallbackProtocol(value: string): string {
  if (PROTOCOL_REGEX.test(value)) {
    return value;
  }
  return `ws://${value}`;
}

function toWsProtocol(protocol: string): "ws:" | "wss:" {
  if (protocol === "https:") {
    return "wss:";
  }
  return "ws:";
}

function toHttpProtocol(protocol: string): "http:" | "https:" {
  if (protocol === "wss:") {
    return "https:";
  }
  return "http:";
}

function parseServerUrl(rawValue?: string): URL {
  const normalized = withFallbackProtocol(
    (rawValue ?? DEFAULT_SERVER_URL).trim()
  );
  return new URL(normalized);
}

function stripTrailingTrpcPath(pathname: string): string {
  if (pathname === TRPC_SUFFIX) {
    return "/";
  }
  if (pathname.endsWith(TRPC_SUFFIX)) {
    const next = pathname.slice(0, -TRPC_SUFFIX.length);
    return next.length > 0 ? next : "/";
  }
  return pathname;
}

function joinPath(basePath: string, nextPath: string): string {
  const base = basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  const next = nextPath.startsWith("/") ? nextPath : `/${nextPath}`;
  return `${base}${next}` || "/";
}

function formatNormalizedServerUrl(url: URL): string {
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.protocol}//${url.host}${path}`;
}

function normalizeUrlObject(url: URL): string {
  url.protocol = toWsProtocol(url.protocol);
  url.pathname = stripTrailingTrpcPath(url.pathname);
  // Desktop builds can resolve localhost to IPv6 (::1) while backend listens on IPv4.
  // Normalize to loopback IPv4 to avoid connection-refused flakiness.
  if (
    url.hostname === "localhost" ||
    url.hostname === "0.0.0.0" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]"
  ) {
    url.hostname = "127.0.0.1";
  }
  url.search = "";
  url.hash = "";
  return formatNormalizedServerUrl(url);
}

function resolveDefaultServerUrl(): string {
  const envValue = String(import.meta.env.VITE_SERVER_URL ?? "").trim();
  if (!envValue) {
    return FALLBACK_SERVER_URL;
  }

  try {
    const url = new URL(withFallbackProtocol(envValue));
    return normalizeUrlObject(url);
  } catch {
    return FALLBACK_SERVER_URL;
  }
}

export const DEFAULT_SERVER_URL = resolveDefaultServerUrl();

export function normalizeServerUrl(rawValue?: string): string {
  return normalizeUrlObject(parseServerUrl(rawValue));
}

export function buildTrpcWsUrl(rawValue?: string): string {
  const baseUrl = new URL(normalizeServerUrl(rawValue));
  baseUrl.pathname = joinPath(baseUrl.pathname, TRPC_SUFFIX);
  baseUrl.search = "";
  baseUrl.hash = "";
  return baseUrl.toString();
}

export function buildHttpApiUrl(rawValue: string, apiPath: string): string {
  const wsBase = new URL(normalizeServerUrl(rawValue));
  wsBase.protocol = toHttpProtocol(wsBase.protocol);
  wsBase.pathname = joinPath(wsBase.pathname, apiPath);
  wsBase.search = "";
  wsBase.hash = "";
  return wsBase.toString();
}
