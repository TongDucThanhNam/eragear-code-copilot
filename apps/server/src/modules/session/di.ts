import { systemClock } from "@/platform/time/system-clock";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { SessionRepositoryPort } from "./application/ports/session-repository.port";
import type { SessionRuntimePort } from "./application/ports/session-runtime.port";
import {
  SessionRuntimeStore,
  type SessionRuntimeStorePolicy,
} from "./infra/runtime-store";
import {
  SessionSqliteRepository,
  type SessionSqliteRepositoryPolicy,
} from "./infra/session.repository.sqlite";
import { SessionSqliteWorkerRepository } from "./infra/session.repository.sqlite.worker";

export { SessionRuntimeStore } from "./infra/runtime-store";
export { SessionSqliteRepository } from "./infra/session.repository.sqlite";
export { SessionSqliteWorkerRepository } from "./infra/session.repository.sqlite.worker";
export { SessionAcpAdapter } from "./infra/session-acp.adapter";

export function createSessionRuntimeStore(params: {
  eventBus: EventBusPort;
  policy: SessionRuntimeStorePolicy;
}): SessionRuntimePort {
  return new SessionRuntimeStore(params.eventBus, params.policy);
}

export function createSessionSqliteRepository(params?: {
  clock?: ClockPort;
  policyProvider?: () => SessionSqliteRepositoryPolicy;
}): SessionRepositoryPort {
  return new SessionSqliteRepository({
    clock: params?.clock ?? systemClock,
    ...(params?.policyProvider
      ? { policyProvider: params.policyProvider }
      : {}),
  });
}

export function createSessionRepository(params: {
  useWorker: boolean;
  clock?: ClockPort;
  policyProvider?: () => SessionSqliteRepositoryPolicy;
}): SessionRepositoryPort {
  if (params.useWorker) {
    return new SessionSqliteWorkerRepository();
  }
  return createSessionSqliteRepository({
    clock: params.clock,
    policyProvider: params.policyProvider,
  });
}
