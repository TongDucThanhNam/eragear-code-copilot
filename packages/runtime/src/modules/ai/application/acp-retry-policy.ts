export interface AcpRetryPolicy {
  maxAttempts: number;
  retryBaseDelayMs: number;
}

export interface AcpRetryPolicyInput {
  maxAttempts: number;
  retryBaseDelayMs: number;
}

export function getAcpRetryPolicy(input: AcpRetryPolicyInput): AcpRetryPolicy {
  const maxAttempts = input.maxAttempts;
  const retryBaseDelayMs = input.retryBaseDelayMs;
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
