export interface TimeoutOptions {
  unref?: boolean;
}

export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  options: TimeoutOptions = {}
): Promise<T> {
  const normalizedTimeoutMs = Math.max(1, Math.trunc(timeoutMs));
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
