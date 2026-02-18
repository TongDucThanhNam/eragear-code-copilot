import { ENV } from "@/config/environment";
import type { SessionEventOutboxPort } from "@/modules/session";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { BackgroundTaskSpec } from "@/shared/types/background.types";

const SESSION_EVENT_OUTBOX_DISPATCH_TASK = "session-event-outbox-dispatch";
const SESSION_EVENT_OUTBOX_DISPATCH_INTERVAL_MS = 250;
const SESSION_EVENT_OUTBOX_DISPATCH_BATCH_SIZE = 100;
const SESSION_EVENT_OUTBOX_DISPATCH_MAX_ATTEMPTS = 10;

export function createSessionEventOutboxDispatchTask(params: {
  outbox: SessionEventOutboxPort;
  eventBus: EventBusPort;
}): BackgroundTaskSpec {
  return {
    name: SESSION_EVENT_OUTBOX_DISPATCH_TASK,
    intervalMs: SESSION_EVENT_OUTBOX_DISPATCH_INTERVAL_MS,
    timeoutMs: ENV.backgroundTaskTimeoutMs,
    run: async () => {
      const result = await params.outbox.dispatch(params.eventBus, {
        batchSize: SESSION_EVENT_OUTBOX_DISPATCH_BATCH_SIZE,
        publishTimeoutMs: ENV.sessionEventBusPublishTimeoutMs,
        maxAttempts: SESSION_EVENT_OUTBOX_DISPATCH_MAX_ATTEMPTS,
      });
      return {
        dispatched: result.dispatched,
        failed: result.failed,
        retried: result.retried,
        pending: result.pending,
      };
    },
  };
}
