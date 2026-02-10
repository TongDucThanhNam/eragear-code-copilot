import { ENV } from "@/config/environment";

export interface AcpRetryPolicy {
  maxAttempts: number;
  retryBaseDelayMs: number;
}

export interface AcpRetryPolicyInput {
  maxAttempts: number;
  retryBaseDelayMs: number;
}

export function getAcpRetryPolicy(input?: AcpRetryPolicyInput): AcpRetryPolicy {
  const maxAttempts = input?.maxAttempts ?? ENV.acpRequestMaxAttempts;
  const retryBaseDelayMs =
    input?.retryBaseDelayMs ?? ENV.acpRequestRetryBaseDelayMs;
  return {
    maxAttempts: Math.max(1, Math.trunc(maxAttempts)),
    retryBaseDelayMs: Math.max(1, Math.trunc(retryBaseDelayMs)),
  };
}

export function getAcpRetryDelayMs(
  attempt: number,
  retryBaseDelayMs: number
): number {
  return Math.max(1, Math.trunc(retryBaseDelayMs * attempt));
}
