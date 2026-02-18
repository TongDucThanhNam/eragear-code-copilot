import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { BroadcastEvent } from "@/shared/types/session.types";

export interface SessionEventOutboxEnqueueInput {
  chatId: string;
  userId: string;
  event: BroadcastEvent;
}

export interface SessionEventOutboxDispatchPolicy {
  batchSize: number;
  publishTimeoutMs: number;
  maxAttempts: number;
}

export interface SessionEventOutboxDispatchResult {
  dispatched: number;
  failed: number;
  retried: number;
  pending: number;
}

export interface SessionEventOutboxPort {
  enqueue(input: SessionEventOutboxEnqueueInput): Promise<void>;
  dispatch(
    eventBus: EventBusPort,
    policy: SessionEventOutboxDispatchPolicy
  ): Promise<SessionEventOutboxDispatchResult>;
}
