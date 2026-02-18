import type { SessionAcpPort, SessionEventOutboxPort } from "@/modules/session";
import {
  createSessionEventOutbox,
  createSessionRuntimeStore,
  SessionAcpAdapter,
} from "@/modules/session/di";
import { getLogStore } from "@/platform/logging/log-store";
import { createAppLogger } from "@/platform/logging/logger-adapter";
import { systemClock } from "@/platform/time/system-clock";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import { EventBus } from "@/shared/utils/event-bus";

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
  const sessionEventOutbox = createSessionEventOutbox();
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
