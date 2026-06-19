import { observable } from "@trpc/server/observable";
// biome-ignore lint/style/noRestrictedImports: Platform logging required for tRPC subscription diagnostics
import { shouldEmitRuntimeLog } from "#runtime/platform/logging/runtime-log-level";
import type {
  BroadcastEvent,
  ChatStatus,
} from "#runtime/shared/types/session.types";
import {
  diagnosticsLog,
  estimateJsonBytes,
  isDiagnosticsEnabled,
} from "#runtime/shared/utils/diagnostics.util";

interface SessionEventSubscription {
  source: "runtime" | "stored";
  chatStatus: ChatStatus;
  activeTurnId?: string;
  bufferedEvents: BroadcastEvent[];
  subscribe(listener: (event: BroadcastEvent) => void): () => void;
  release(): Promise<void>;
}

interface SessionEventsService {
  execute(userId: string, chatId: string): Promise<SessionEventSubscription>;
}

interface SessionEventsLogger {
  debug(message: string, context?: Record<string, unknown>): void;
}

export interface CreateSessionEventsObservableParams {
  service: SessionEventsService;
  userId: string;
  chatId: string;
  logger: SessionEventsLogger;
}

export function createSessionReplayEvents(
  subscription: Pick<
    SessionEventSubscription,
    "source" | "chatStatus" | "activeTurnId" | "bufferedEvents"
  >
): BroadcastEvent[] {
  return [
    ...(subscription.source === "runtime"
      ? ([{ type: "connected" }] satisfies BroadcastEvent[])
      : []),
    {
      type: "chat_status",
      status: subscription.chatStatus,
      ...(subscription.activeTurnId
        ? { turnId: subscription.activeTurnId }
        : {}),
    },
    ...subscription.bufferedEvents,
  ];
}

function logSubscriptionReplayDiagnostics(
  chatId: string,
  subscription: SessionEventSubscription
): void {
  if (!isDiagnosticsEnabled()) {
    return;
  }

  let replayBytes = 0;
  for (const event of subscription.bufferedEvents) {
    const bytes = estimateJsonBytes(event);
    if (bytes !== null) {
      replayBytes += bytes;
    }
  }
  diagnosticsLog("subscription-replay", {
    chatId,
    bufferedEventCount: subscription.bufferedEvents.length,
    estimatedBufferedBytes: replayBytes,
    subscriptionSource: subscription.source,
  });
}

function logSubscribeFailure(
  logger: SessionEventsLogger,
  chatId: string,
  error: unknown
): void {
  if (!shouldEmitRuntimeLog("debug")) {
    return;
  }
  logger.debug("tRPC onSessionEvents subscribe failed", {
    chatId,
    error: error instanceof Error ? error.message : String(error),
  });
}

function logSubscribed(
  logger: SessionEventsLogger,
  chatId: string,
  subscription: SessionEventSubscription
): void {
  if (!shouldEmitRuntimeLog("debug")) {
    return;
  }
  logger.debug("tRPC onSessionEvents subscribed", {
    chatId,
    bufferedEvents: subscription.bufferedEvents.length,
    chatStatus: subscription.chatStatus,
    activeTurnId: subscription.activeTurnId,
    subscriptionSource: subscription.source,
  });
}

function logUnsubscribed(logger: SessionEventsLogger, chatId: string): void {
  if (!shouldEmitRuntimeLog("debug")) {
    return;
  }
  logger.debug("tRPC onSessionEvents unsubscribed", { chatId });
}

function logReleaseFailure(
  logger: SessionEventsLogger,
  chatId: string,
  error: unknown
): void {
  if (!shouldEmitRuntimeLog("debug")) {
    return;
  }
  logger.debug("tRPC onSessionEvents release failed", {
    chatId,
    error: error instanceof Error ? error.message : String(error),
  });
}

export function createSessionEventsObservable(
  params: CreateSessionEventsObservableParams
) {
  const { service, userId, chatId, logger } = params;

  return observable<BroadcastEvent>((emit) => {
    let subscription: SessionEventSubscription | undefined;
    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    const start = async () => {
      try {
        subscription = await service.execute(userId, chatId);
      } catch (error) {
        logSubscribeFailure(logger, chatId, error);
        if (!disposed) {
          emit.error(
            error instanceof Error ? error : new Error("Chat not found")
          );
        }
        return;
      }

      if (disposed || !subscription) {
        if (subscription) {
          await subscription.release().catch(() => undefined);
        }
        return;
      }

      logSubscribed(logger, chatId, subscription);

      for (const event of createSessionReplayEvents(subscription)) {
        emit.next(event);
      }

      logSubscriptionReplayDiagnostics(chatId, subscription);

      unsubscribe = subscription.subscribe((event) => {
        emit.next(event);
      });
    };

    // biome-ignore lint/complexity/noVoid: Intentional fire-and-forget for subscription startup
    void start();

    return () => {
      disposed = true;
      logUnsubscribed(logger, chatId);
      unsubscribe?.();
      if (subscription) {
        // biome-ignore lint/complexity/noVoid: Intentional fire-and-forget for subscription release
        void subscription.release().catch((error) => {
          logReleaseFailure(logger, chatId, error);
        });
      }
    };
  });
}
