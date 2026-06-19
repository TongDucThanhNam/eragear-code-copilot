export interface TimeoutOptions {
  unref?: boolean;
}

export const MAX_SET_TIMEOUT_MS = 2_147_483_647;

export function normalizeTimeoutMs(timeoutMs: number): {
  timeoutMs: number;
  clamped: boolean;
} {
  const normalized = Math.max(1, Math.trunc(timeoutMs));
  if (normalized > MAX_SET_TIMEOUT_MS) {
    return {
      timeoutMs: MAX_SET_TIMEOUT_MS,
      clamped: true,
    };
  }
  return {
    timeoutMs: normalized,
    clamped: false,
  };
}

export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  options: TimeoutOptions = {}
): Promise<T> {
  const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs).timeoutMs;
  const shouldUnref = options.unref ?? true;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, normalizedTimeoutMs);
    if (shouldUnref) {
      timeoutHandle.unref?.();
    }
  });

  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}
