import {
  createEventBusSessionBroadcastNotifier,
  type SessionAcpPort,
  type SessionEventOutboxPort,
} from "#runtime/modules/session";
import {
  createSessionEventOutbox,
  createSessionRuntimeStore,
  SessionAcpAdapter,
} from "#runtime/modules/session/di";
import { getLogStore } from "#runtime/platform/logging/log-store";
import { createAppLogger } from "#runtime/platform/logging/logger-adapter";
import { systemClock } from "#runtime/platform/time/system-clock";
import type { ClockPort } from "#runtime/shared/ports/clock.port";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LogStorePort } from "#runtime/shared/ports/log-store.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import { EventBus } from "#runtime/shared/utils/event-bus";

export interface CoreModuleInitPolicy {
  sessionBufferLimit: number;
  sessionLockAcquireTimeoutMs: number;
  sessionEventBusPublishMaxQueuePerChat: number;
}

export interface CoreModule {
  eventBus: EventBusPort;
  sessionEventOutbox: SessionEventOutboxPort;
  sessionRuntime: ReturnType<typeof createSessionRuntimeStore>;
  logStore: LogStorePort;
  appLogger: LoggerPort;
  clock: ClockPort;
  sessionAcpAdapter: SessionAcpPort;
}

export function initializeCoreModule(policy: CoreModuleInitPolicy): CoreModule {
  const appLogger = createAppLogger("Server");
  const eventBus = new EventBus(appLogger);
  const sessionEventOutbox = createSessionEventOutbox({
    broadcastNotifier: createEventBusSessionBroadcastNotifier(eventBus),
  });
  const sessionRuntime = createSessionRuntimeStore({
    outbox: sessionEventOutbox,
    policy: {
      sessionBufferLimit: policy.sessionBufferLimit,
      lockAcquireTimeoutMs: policy.sessionLockAcquireTimeoutMs,
      eventBusPublishMaxQueuePerChat:
        policy.sessionEventBusPublishMaxQueuePerChat,
    },
  });

  return {
    eventBus,
    sessionEventOutbox,
    sessionRuntime,
    logStore: getLogStore(),
    appLogger,
    clock: systemClock,
    sessionAcpAdapter: new SessionAcpAdapter(),
  };
}
