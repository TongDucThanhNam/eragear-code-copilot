import { Platform } from "react-native";

const PROTOCOL_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;
const TRPC_SUFFIX = "/trpc";
const TRAILING_SLASH_REGEX = /\/+$/;

const LOCAL_DEV_URL_REGEX = /localhost|127\.0\.0\.1|10\.0\.2\.2/;

export function getDefaultServerUrl(): string {
  const host = Platform.OS === "android" ? "10.0.2.2" : "localhost";
  return `http://${host}:3000`;
}

export function isLocalDevUrl(url: string): boolean {
  return LOCAL_DEV_URL_REGEX.test(url);
}

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
  const defaultServerUrl = getDefaultServerUrl();
  const normalized = withFallbackProtocol(
    (rawValue ?? defaultServerUrl).trim() || defaultServerUrl
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
  const base =
    basePath === "/" ? "" : basePath.replace(TRAILING_SLASH_REGEX, "");
  const next = nextPath.startsWith("/") ? nextPath : `/${nextPath}`;
  return `${base}${next}` || "/";
}

function toBaseUrl(url: URL): string {
  const path =
    url.pathname === "/" ? "" : url.pathname.replace(TRAILING_SLASH_REGEX, "");
  return `${url.protocol}//${url.host}${path}`;
}

export function normalizeServerUrl(rawValue?: string): string {
  const url = parseServerUrl(rawValue);
  url.protocol = toWsProtocol(url.protocol);
  url.pathname = stripTrailingTrpcPath(url.pathname);
  url.search = "";
  url.hash = "";
  return toBaseUrl(url);
}

export function toWsUrl(url: string): string {
  return normalizeServerUrl(url);
}

export function buildTrpcWsUrl(rawValue?: string): string {
  const wsBase = new URL(normalizeServerUrl(rawValue));
  wsBase.pathname = joinPath(wsBase.pathname, TRPC_SUFFIX);
  wsBase.search = "";
  wsBase.hash = "";
  return wsBase.toString();
}

export function toHttpUrl(url: string): string {
  const httpBase = new URL(normalizeServerUrl(url));
  httpBase.protocol = toHttpProtocol(httpBase.protocol);
  httpBase.search = "";
  httpBase.hash = "";
  return toBaseUrl(httpBase);
}
