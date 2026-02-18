import {
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import type { IncomingMessage } from "node:http";

const CLOUDFLARE_ACCESS_CLIENT_ID_HEADER = "cf-access-client-id";
const CLOUDFLARE_ACCESS_CLIENT_SECRET_HEADER = "cf-access-client-secret";
const CLOUDFLARE_ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
const JWT_CLOCK_SKEW_SECONDS = 30;

const JWT_SIGNATURE_ALGORITHMS = {
  RS256: "RSA-SHA256",
  RS384: "RSA-SHA384",
  RS512: "RSA-SHA512",
} as const;

type SupportedJwtAlgorithm = keyof typeof JWT_SIGNATURE_ALGORITHMS;

interface JwtHeader {
  alg?: string;
}

interface JwtClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
}

interface CloudflareJwtPolicy {
  publicKeyPem: string;
  audience: string;
  issuer: string;
}

export interface CloudflareAccessHandshakePolicy {
  clientId?: string;
  clientSecret?: string;
  jwt?: CloudflareJwtPolicy;
}

export interface CloudflareAccessHandshakeCheckResult {
  ok: boolean;
  reason?:
    | "missing_credentials"
    | "invalid_service_token"
    | "service_token_not_configured"
    | "partial_service_token_headers"
    | "jwt_not_configured"
    | "invalid_jwt";
}

function readHeaderValue(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const trimmed = item.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseJsonObject<T>(value: Buffer): T | null {
  try {
    const parsed = JSON.parse(value.toString("utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

function decodeBase64UrlSegment(segment: string): Buffer | null {
  if (segment.length === 0) {
    return null;
  }
  try {
    return Buffer.from(segment, "base64url");
  } catch {
    return null;
  }
}

function normalizeJwtAlgorithm(value: unknown): SupportedJwtAlgorithm | null {
  if (typeof value !== "string") {
    return null;
  }
  if (!(value in JWT_SIGNATURE_ALGORITHMS)) {
    return null;
  }
  return value as SupportedJwtAlgorithm;
}

function isValidAudience(
  audienceClaim: string | string[] | undefined,
  expectedAudience: string
): boolean {
  if (typeof audienceClaim === "string") {
    return audienceClaim === expectedAudience;
  }
  if (Array.isArray(audienceClaim)) {
    return audienceClaim.includes(expectedAudience);
  }
  return false;
}

function isNumericDate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function verifyCloudflareJwtAssertion(
  assertion: string,
  policy: CloudflareJwtPolicy
): boolean {
  const segments = assertion.split(".");
  if (segments.length !== 3) {
    return false;
  }

  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (!(headerSegment && payloadSegment && signatureSegment)) {
    return false;
  }

  const headerBuffer = decodeBase64UrlSegment(headerSegment);
  const payloadBuffer = decodeBase64UrlSegment(payloadSegment);
  const signatureBuffer = decodeBase64UrlSegment(signatureSegment);
  if (!(headerBuffer && payloadBuffer && signatureBuffer)) {
    return false;
  }

  const header = parseJsonObject<JwtHeader>(headerBuffer);
  const claims = parseJsonObject<JwtClaims>(payloadBuffer);
  if (!(header && claims)) {
    return false;
  }

  const algorithm = normalizeJwtAlgorithm(header.alg);
  if (!algorithm) {
    return false;
  }

  const signingInput = Buffer.from(`${headerSegment}.${payloadSegment}`);
  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey(policy.publicKeyPem);
  } catch {
    return false;
  }

  let signatureIsValid = false;
  try {
    signatureIsValid = verifySignature(
      JWT_SIGNATURE_ALGORITHMS[algorithm],
      signingInput,
      publicKey,
      signatureBuffer
    );
  } catch {
    return false;
  }
  if (!signatureIsValid) {
    return false;
  }

  if (claims.iss !== policy.issuer) {
    return false;
  }
  if (!isValidAudience(claims.aud, policy.audience)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (isNumericDate(claims.exp)) {
    const latestAllowed = claims.exp + JWT_CLOCK_SKEW_SECONDS;
    if (nowSeconds > latestAllowed) {
      return false;
    }
  }
  if (isNumericDate(claims.nbf)) {
    const earliestAllowed = claims.nbf - JWT_CLOCK_SKEW_SECONDS;
    if (nowSeconds < earliestAllowed) {
      return false;
    }
  }

  return true;
}

export function validateCloudflareAccessHandshakeAuth(
  headers: IncomingMessage["headers"],
  policy: CloudflareAccessHandshakePolicy
): CloudflareAccessHandshakeCheckResult {
  const configuredClientId = policy.clientId?.trim();
  const configuredClientSecret = policy.clientSecret?.trim();
  const serviceTokenConfigured = Boolean(
    configuredClientId && configuredClientSecret
  );
  const jwtConfigured = Boolean(
    policy.jwt &&
      policy.jwt.publicKeyPem.trim().length > 0 &&
      policy.jwt.audience.trim().length > 0 &&
      policy.jwt.issuer.trim().length > 0
  );

  const providedClientId = readHeaderValue(
    headers[CLOUDFLARE_ACCESS_CLIENT_ID_HEADER]
  );
  const providedClientSecret = readHeaderValue(
    headers[CLOUDFLARE_ACCESS_CLIENT_SECRET_HEADER]
  );
  if (
    (providedClientId && !providedClientSecret) ||
    (!providedClientId && providedClientSecret)
  ) {
    return { ok: false, reason: "partial_service_token_headers" };
  }

  if (providedClientId && providedClientSecret) {
    if (
      !(serviceTokenConfigured && configuredClientId && configuredClientSecret)
    ) {
      return { ok: false, reason: "service_token_not_configured" };
    }
    const clientIdMatches = timingSafeStringEqual(
      providedClientId,
      configuredClientId
    );
    const clientSecretMatches = timingSafeStringEqual(
      providedClientSecret,
      configuredClientSecret
    );
    if (!(clientIdMatches && clientSecretMatches)) {
      return { ok: false, reason: "invalid_service_token" };
    }
    return { ok: true };
  }

  const jwtAssertion = readHeaderValue(headers[CLOUDFLARE_ACCESS_JWT_HEADER]);
  if (jwtAssertion) {
    if (!(jwtConfigured && policy.jwt)) {
      return { ok: false, reason: "jwt_not_configured" };
    }
    const isValid = verifyCloudflareJwtAssertion(jwtAssertion, policy.jwt);
    if (!isValid) {
      return { ok: false, reason: "invalid_jwt" };
    }
    return { ok: true };
  }

  return { ok: false, reason: "missing_credentials" };
}

export function hasCloudflareAccessHandshakeAuth(
  headers: IncomingMessage["headers"],
  policy: CloudflareAccessHandshakePolicy
): boolean {
  return validateCloudflareAccessHandshakeAuth(headers, policy).ok;
}
