/**
 * CORS Origin Resolution
 *
 * Handles origin resolution from various sources (Origin header, Host header,
 * X-Forwarded-* headers, Cloudflare headers). Supports both local and
 * distributed deployments (reverse proxies, Cloudflare Tunnels).
 *
 * @module transport/http/cors
 */

// biome-ignore lint/style/noRestrictedImports: transport CORS boundary needs server logger sink.
import { createLogger } from "@/platform/logging/structured-logger";

const logger = createLogger("Auth");

/**
 * Normalizes and validates an origin URL
 *
 * @param value - Raw origin value from headers
 * @returns Normalized origin (protocol + host) or null if invalid
 */
export function normalizeOrigin(value: string | null): string | null {
  if (!value || value === "null") {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Gets the protocol from X-Forwarded-Proto or Cloudflare CF-Visitor header
 *
 * Used for deployments behind reverse proxies or Cloudflare Tunnel.
 * X-Forwarded-Proto is checked first (more common), then CF-Visitor fallback.
 *
 * @param headers - Request headers
 * @returns Protocol string ('http' or 'https') or null if not found
 */
export function getForwardedProto(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-proto");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }

  const cfVisitor = headers.get("cf-visitor");
  if (cfVisitor) {
    try {
      const parsed = JSON.parse(cfVisitor) as { scheme?: string };
      if (parsed.scheme) {
        return parsed.scheme;
      }
    } catch (error) {
      logger.warn("Failed to parse CF-Visitor header", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

/**
 * Resolves the origin from X-Forwarded-Host and protocol headers
 *
 * Used for deployments behind reverse proxies that set X-Forwarded-* headers.
 *
 * @param headers - Request headers
 * @returns Full origin URL or null if no valid host found
 */
export function resolveHostOrigin(headers: Headers): string | null {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) {
    return null;
  }
  const proto = getForwardedProto(headers) ?? "http";
  if (proto !== "http" && proto !== "https") {
    return null;
  }

  return `${proto}://${host}`;
}

/**
 * Resolves the request origin from headers
 *
 * Priority:
 * 1. Origin header (with validation against Host)
 * 2. Host origin from X-Forwarded-Host/Host + X-Forwarded-Proto/CF-Visitor
 *
 * @param headers - Request headers
 * @returns Resolved origin or null if cannot determine
 */
export function resolveRequestOrigin(headers: Headers): string | null {
  const originHeader = normalizeOrigin(headers.get("origin"));
  const hostOrigin = resolveHostOrigin(headers);

  if (originHeader) {
    if (hostOrigin && originHeader !== hostOrigin) {
      logger.debug("Origin mismatch detected", {
        originHeader,
        hostOrigin,
      });
      return null;
    }
    logger.debug("Using origin from request header", { originHeader });
    return originHeader;
  }

  logger.debug("Using host-origin fallback", { hostOrigin });
  return hostOrigin;
}

/**
 * Determines CORS origin for response based on request origin and trusted list
 *
 * This function is used directly in Hono's cors() middleware as the `origin` callback.
 * Returns the validated origin string or undefined to deny the request.
 *
 * @param origin - Raw origin string from headers
 * @param trustedOrigins - Trusted origins list from config (["*"] or specific URLs)
 * @returns Origin string if allowed, undefined otherwise
 */
export function resolveCorsOrigin(
  origin: string | null | undefined,
  trustedOrigins: string[] | string,
  strict: boolean
): string | undefined {
  const normalized = normalizeOrigin(origin ?? null);

  if (!normalized) {
    // No/invalid Origin header: do not emit ACAO.
    return undefined;
  }

  if (Array.isArray(trustedOrigins)) {
    if (trustedOrigins[0] === "*" || trustedOrigins.includes(normalized)) {
      return normalized;
    }
    if (strict) {
      logger.warn("CORS denied because origin is not trusted", { normalized });
      return undefined;
    }
    logger.warn("CORS permissive mode allowing untrusted origin", {
      normalized,
    });
    return normalized;
  }

  if (trustedOrigins === "*") {
    return normalized;
  }

  if (trustedOrigins === normalized) {
    return normalized;
  }

  if (strict) {
    logger.warn("CORS denied because trusted origin mismatch", { normalized });
    return undefined;
  }

  logger.warn("CORS permissive mode allowing unmatched origin", {
    normalized,
  });
  return normalized;
}
