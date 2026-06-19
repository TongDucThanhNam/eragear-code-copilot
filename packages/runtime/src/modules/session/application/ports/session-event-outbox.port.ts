import type { BroadcastEvent } from "#runtime/shared/types/session.types";

/**
 * Durable broadcast event envelope.
 *
 * Invariant: `userId` is copied at enqueue time so later runtime deletion does
 * not make authorization context ambiguous during dispatch.
 */
export interface SessionEventOutboxEnqueueInput {
  chatId: string;
  userId: string;
  event: BroadcastEvent;
}

/**
 * Dispatch policy for draining the durable session event outbox.
 *
 * Caller contract: adapters should honor `maxAttempts` before leaving an event
 * pending or failed for the next maintenance pass.
 */
export interface SessionEventOutboxDispatchPolicy {
  batchSize: number;
  publishTimeoutMs: number;
  maxAttempts: number;
}

/**
 * Summary of one outbox dispatch pass.
 *
 * Invariant: counts describe attempted work for the pass, not lifetime totals.
 */
export interface SessionEventOutboxDispatchResult {
  dispatched: number;
  failed: number;
  retried: number;
  pending: number;
}

/**
 * Durable outbox for session broadcast events.
 *
 * Side effect: `enqueue` persists events for later fan-out; `dispatchDue`
 * publishes via the configured broadcast notifier and updates retry/failure
 * state.
 */
export interface SessionEventOutboxPort {
  enqueue(input: SessionEventOutboxEnqueueInput): Promise<void>;
  dispatchDue(
    policy: SessionEventOutboxDispatchPolicy
  ): Promise<SessionEventOutboxDispatchResult>;
}
