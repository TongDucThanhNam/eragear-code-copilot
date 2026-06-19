export interface SseStreamSender {
  readonly closed: boolean;
  close(): void;
  sendRaw(payload: string, options?: SseSendOptions): boolean;
  sendEvent(event: string, data: unknown, options?: SseSendOptions): boolean;
}

interface SseSendOptions {
  closeOnBackpressure?: boolean;
}

interface ManagedSseStreamParams {
  signal?: AbortSignal | null;
  heartbeatIntervalMs?: number;
  start(sender: SseStreamSender): (() => void) | undefined;
  heartbeat?(sender: SseStreamSender): void;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

export function createManagedSseStream(
  params: ManagedSseStreamParams
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const abortSignal = params.signal ?? null;

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    abortSignal?.removeEventListener("abort", close);
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (controllerRef) {
      try {
        controllerRef.close();
      } catch {
        // The stream may already be closed or canceled.
      }
      controllerRef = null;
    }
  };

  const sender: SseStreamSender = {
    get closed() {
      return closed;
    },
    close,
    sendRaw(payload, options) {
      if (closed || !controllerRef) {
        return false;
      }
      const closeOnBackpressure = options?.closeOnBackpressure ?? true;
      if (
        closeOnBackpressure &&
        controllerRef.desiredSize !== null &&
        controllerRef.desiredSize <= 0
      ) {
        // Fail fast on slow consumers so SSE buffers cannot grow without bound.
        close();
        return false;
      }
      try {
        controllerRef.enqueue(encoder.encode(payload));
        return true;
      } catch {
        close();
        return false;
      }
    },
    sendEvent(event, data, options) {
      return sender.sendRaw(
        `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
        options
      );
    },
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      if (abortSignal?.aborted) {
        close();
        return;
      }

      try {
        unsubscribe = params.start(sender) ?? null;
      } catch (error) {
        close();
        throw error;
      }

      if (closed) {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        return;
      }

      if (params.heartbeat) {
        heartbeat = setInterval(() => {
          params.heartbeat?.(sender);
        }, params.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
        heartbeat.unref?.();
      }

      abortSignal?.addEventListener("abort", close, { once: true });
    },
    cancel() {
      close();
    },
  });
}
