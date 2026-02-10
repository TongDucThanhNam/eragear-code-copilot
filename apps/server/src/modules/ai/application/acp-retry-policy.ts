import { ENV } from "@/config/environment";

export interface AcpRetryPolicy {
  maxAttempts: number;
  retryBaseDelayMs: number;
}

export function getAcpRetryPolicy(): AcpRetryPolicy {
  return {
    maxAttempts: Math.max(1, Math.trunc(ENV.acpRequestMaxAttempts)),
    retryBaseDelayMs: Math.max(1, Math.trunc(ENV.acpRequestRetryBaseDelayMs)),
  };
}

export function getAcpRetryDelayMs(
  attempt: number,
  retryBaseDelayMs: number
): number {
  return Math.max(1, Math.trunc(retryBaseDelayMs * attempt));
}
