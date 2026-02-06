/**
 * Observability Context
 *
 * Async context propagation for request/task correlation across logs.
 *
 * @module shared/utils/observability-context.util
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type ObservabilitySource = "http" | "ws" | "background";

export interface ObservabilityContext {
  requestId?: string;
  traceId?: string;
  userId?: string;
  chatId?: string;
  route?: string;
  source?: ObservabilitySource;
  taskName?: string;
  taskRunId?: string;
}

const storage = new AsyncLocalStorage<ObservabilityContext>();

export function withObservabilityContext<T>(
  context: ObservabilityContext,
  fn: () => T
): T {
  return storage.run(context, fn);
}

export function getObservabilityContext(): ObservabilityContext | undefined {
  return storage.getStore();
}

export function patchObservabilityContext(
  partial: Partial<ObservabilityContext>
) {
  const current = storage.getStore();
  if (!current) {
    return;
  }
  Object.assign(current, partial);
}
