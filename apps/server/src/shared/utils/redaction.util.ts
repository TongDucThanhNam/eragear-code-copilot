const CORE_SENSITIVE_KEYS = [
  "accessToken",
  "apiKey",
  "apikey",
  "authorization",
  "clientSecret",
  "cookie",
  "password",
  "refreshToken",
  "secret",
  "sessionToken",
  "setCookie",
  "token",
] as const;

export const ACP_RAW_LOG_REDACTED_KEYS = [
  ...CORE_SENSITIVE_KEYS,
  "blob",
  "data",
  "input",
  "output",
  "rawInput",
  "rawOutput",
  "text",
] as const;

export type RedactionReason =
  | "credential"
  | "message_content"
  | "structured_payload"
  | "filesystem_path"
  | "runtime_metadata";

export interface RedactedValue {
  kind: "redacted";
  reason: RedactionReason;
  summary: string;
}

const ACP_RAW_LOG_REDACTED_KEY_SET = new Set(
  ACP_RAW_LOG_REDACTED_KEYS.map((key) => normalizeRedactionKey(key))
);
const SECRET_ASSIGNMENT_RE =
  /\b(access[_-]?token|api[_-]?key|authorization|bearer|client[_-]?secret|cookie|password|refresh[_-]?token|secret|session[_-]?token|token)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+(?:\s+[^\s,;]+)?)/gi;
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi;
const BASIC_AUTH_RE = /\bBasic\s+[A-Za-z0-9+/=]{8,}\b/gi;
const HIGH_ENTROPY_TOKEN_RE = /\b[A-Za-z0-9+/=_-]{20,}\b/g;
const HAS_ALPHA_RE = /[A-Za-z]/;
const HAS_DIGIT_RE = /\d/;

export function shouldRedactAcpRawLogKey(key: string): boolean {
  return ACP_RAW_LOG_REDACTED_KEY_SET.has(normalizeRedactionKey(key));
}

export function createRedactedValue(
  reason: RedactionReason,
  value: unknown
): RedactedValue {
  return {
    kind: "redacted",
    reason,
    summary: summarizeRedactedValue(value),
  };
}

export function summarizeRedactedValue(value: unknown): string {
  if (typeof value === "string") {
    return `${value.length} chars`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return `${value.toString().length} digits`;
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    return `object(${keys.length} keys)`;
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

export function redactRawPayloadValue(value: unknown): string | unknown {
  if (typeof value === "string") {
    return `[redacted:${value.length} chars]`;
  }
  if (Array.isArray(value)) {
    return `[redacted:array(${value.length})]`;
  }
  if (value && typeof value === "object") {
    return "[redacted:object]";
  }
  return value;
}

export function redactSensitiveTextSample(value: string): string {
  let redacted = value
    .replace(
      SECRET_ASSIGNMENT_RE,
      (_match, key: string, separator: string) => `${key}${separator}[redacted]`
    )
    .replace(BEARER_TOKEN_RE, "Bearer [redacted]")
    .replace(BASIC_AUTH_RE, "Basic [redacted]");

  redacted = redacted.replace(HIGH_ENTROPY_TOKEN_RE, (token) =>
    shouldRedactHighEntropyToken(token)
      ? `[redacted:${token.length} chars]`
      : token
  );

  return redacted;
}

function shouldRedactHighEntropyToken(token: string): boolean {
  const hasAlpha = HAS_ALPHA_RE.test(token);
  const hasDigit = HAS_DIGIT_RE.test(token);
  if (!(hasAlpha && hasDigit)) {
    return false;
  }
  return shannonEntropy(token) >= 3.5;
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function normalizeRedactionKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}
