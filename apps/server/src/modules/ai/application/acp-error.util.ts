interface AcpErrorShape {
  message?: unknown;
  data?: { details?: unknown };
}

export type AcpErrorKind =
  | "retryable_transport"
  | "fatal_process"
  | "fatal_session"
  | "unknown";

const RETRYABLE_TRANSPORT_PATTERNS = [
  "processtransport is not ready for writing",
  "transport is not ready for writing",
] as const;

const FATAL_PROCESS_PATTERNS = [
  "process exited",
  "terminated",
  "cannot write to terminated process",
] as const;

const FATAL_SESSION_PATTERNS = [
  "session not found",
  "unknown session",
  "invalid session",
  "session is closed",
  "session closed",
  "session does not exist",
] as const;

function includesAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

export const getAcpErrorText = (error: unknown): string => {
  const parts: string[] = [];
  const pushPart = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    parts.push(normalized);
  };

  if (error instanceof Error) {
    pushPart(error.message);
  }

  if (typeof error === "string") {
    pushPart(error);
  }

  if (typeof error === "object" && error) {
    const err = error as AcpErrorShape;
    pushPart(err.message);
    pushPart(err.data?.details);
  }

  return [...new Set(parts)].join(" | ");
};

export function classifyAcpError(error: unknown): {
  text: string;
  kind: AcpErrorKind;
} {
  const text = getAcpErrorText(error);
  const normalized = text.toLowerCase();
  if (!normalized) {
    return { text, kind: "unknown" };
  }
  if (includesAny(normalized, RETRYABLE_TRANSPORT_PATTERNS)) {
    return { text, kind: "retryable_transport" };
  }
  if (includesAny(normalized, FATAL_PROCESS_PATTERNS)) {
    return { text, kind: "fatal_process" };
  }
  if (includesAny(normalized, FATAL_SESSION_PATTERNS)) {
    return { text, kind: "fatal_session" };
  }
  return { text, kind: "unknown" };
}

export const isProcessTransportNotReady = (errorText: string) => {
  return includesAny(errorText.toLowerCase(), RETRYABLE_TRANSPORT_PATTERNS);
};

export const isProcessExited = (errorText: string) => {
  const normalized = errorText.toLowerCase();
  return includesAny(normalized, FATAL_PROCESS_PATTERNS);
};

export const isMethodNotFound = (errorText: string) => {
  return errorText.toLowerCase().includes("method not found");
};
