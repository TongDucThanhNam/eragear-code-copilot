import { createHash } from "node:crypto";
import type { SupervisorCapacityFailureKind } from "../domain/supervisor-run.schemas";

const MAX_DIAGNOSTIC_CHARS = 2000;
const NO_ETA_BACKOFF_MINUTES = [1, 5, 15, 30, 60] as const;
const QUOTA_EXHAUSTED_PATTERN =
  /\b(insufficient[_ -]?quota|quota (?:is )?(?:exhausted|exceeded)|usage limit (?:reached|exceeded)|credit(?:s)? exhausted|plan limit (?:reached|exceeded))\b/;
const RATE_LIMIT_PATTERN =
  /\b(429|rate[_ -]?limit(?:ed)?|too many requests|resource exhausted|throttl(?:e|ed|ing))\b/;
const AUTH_REQUIRED_PATTERN =
  /\b(401|403|unauthori[sz]ed|forbidden|authentication required|auth required|token expired|invalid (?:api )?key)\b/;
const SESSION_FATAL_PATTERN =
  /\b(session (?:not found|expired|invalid|closed)|invalid session|failed to (?:load|resume) (?:agent )?session|agent_session_load_failed)\b/;
const TRANSPORT_FAILURE_PATTERN =
  /\b(econnreset|econnrefused|etimedout|epipe|network|socket|transport|connection (?:closed|reset|lost)|temporarily unavailable|timeout)\b/;
const RESET_AT_PATTERN =
  /(?:reset(?:s|At|_at)?|retry(?:At|_at)?)[^\d]*(\d{4}-\d{2}-\d{2}(?:T|\s)\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/i;

export interface AcpCapacityFailureInput {
  error?: unknown;
  jsonRpcError?: unknown;
  metadata?: Record<string, unknown>;
  stderr?: string;
  assistantFailure?: string;
}

export interface AcpCapacityClassification {
  kind: SupervisorCapacityFailureKind;
  reason: string;
  resetAt?: string;
  retryable: boolean;
}

export function classifyAcpCapacityFailure(
  input: AcpCapacityFailureInput
): AcpCapacityClassification {
  const combined = redactAcpDiagnostic(
    [
      errorText(input.error),
      stringifyBounded(input.jsonRpcError),
      stringifyBounded(input.metadata),
      input.stderr,
      input.assistantFailure,
    ]
      .filter(Boolean)
      .join("\n")
  );
  const normalized = combined.toLowerCase();
  const resetAt = extractResetAt(input.metadata, combined);
  if (QUOTA_EXHAUSTED_PATTERN.test(normalized)) {
    return result("quota_exhausted", combined, true, resetAt);
  }
  if (RATE_LIMIT_PATTERN.test(normalized)) {
    return result("transient_rate_limit", combined, true, resetAt);
  }
  if (AUTH_REQUIRED_PATTERN.test(normalized)) {
    return result("auth_required", combined, false, resetAt);
  }
  if (SESSION_FATAL_PATTERN.test(normalized)) {
    return result("session_fatal", combined, false, resetAt);
  }
  if (TRANSPORT_FAILURE_PATTERN.test(normalized)) {
    return result("transport", combined, true, resetAt);
  }
  return result(
    "unknown",
    combined || "Unclassified ACP failure",
    false,
    resetAt
  );
}

export function computeCapacityRetryAt(input: {
  nowMs: number;
  resetAt?: string;
  backoffStep: number;
  jitterSeed: string;
}): string {
  const resetMs = input.resetAt ? Date.parse(input.resetAt) : Number.NaN;
  if (Number.isFinite(resetMs) && resetMs > input.nowMs) {
    return new Date(
      resetMs + deterministicJitterMs(input.jitterSeed)
    ).toISOString();
  }
  const index = Math.min(
    Math.max(0, Math.trunc(input.backoffStep)),
    NO_ETA_BACKOFF_MINUTES.length - 1
  );
  return new Date(
    input.nowMs + (NO_ETA_BACKOFF_MINUTES[index] ?? 60) * 60 * 1000
  ).toISOString();
}

export function redactAcpDiagnostic(value: string): string {
  return value
    .replace(
      /\b(?:sk|pk|api|key|token|bearer)[-_][a-z0-9._-]{8,}\b/gi,
      "[REDACTED]"
    )
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?\S+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|key|secret)=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, MAX_DIAGNOSTIC_CHARS);
}

function result(
  kind: SupervisorCapacityFailureKind,
  reason: string,
  retryable: boolean,
  resetAt?: string
): AcpCapacityClassification {
  return {
    kind,
    reason: reason || kind,
    retryable,
    ...(resetAt ? { resetAt } : {}),
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${stringifyBounded(
      "details" in error ? error.details : undefined
    )}`;
  }
  return stringifyBounded(error);
}

function stringifyBounded(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value.slice(0, MAX_DIAGNOSTIC_CHARS);
  }
  try {
    return JSON.stringify(value).slice(0, MAX_DIAGNOSTIC_CHARS);
  } catch {
    return String(value).slice(0, MAX_DIAGNOSTIC_CHARS);
  }
}

function extractResetAt(
  metadata: Record<string, unknown> | undefined,
  diagnostic: string
): string | undefined {
  const direct = metadata?.resetAt ?? metadata?.reset_at ?? metadata?.retryAt;
  const parsedDirect = parseTimestamp(direct);
  if (parsedDirect) {
    return parsedDirect;
  }
  const match = diagnostic.match(RESET_AT_PATTERN);
  return parseTimestamp(match?.[1]);
}

function parseTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(millis).toISOString();
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
}

function deterministicJitterMs(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) % 30_001;
}
