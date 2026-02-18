import {
  getSqliteOrm,
  withSqliteTransaction,
} from "@/platform/storage/sqlite-db";
import { systemClock } from "@/platform/time/system-clock";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { SessionEventOutboxPort } from "./application/ports/session-event-outbox.port";
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
import { SessionEventOutboxSqliteAdapter } from "./infra/session-event-outbox.sqlite";

export { SessionRuntimeStore } from "./infra/runtime-store";
export { SessionSqliteRepository } from "./infra/session.repository.sqlite";
export { SessionSqliteWorkerRepository } from "./infra/session.repository.sqlite.worker";
export { SessionAcpAdapter } from "./infra/session-acp.adapter";
export { SessionEventOutboxSqliteAdapter } from "./infra/session-event-outbox.sqlite";

export function createSessionRuntimeStore(params: {
  outbox: SessionEventOutboxPort;
  policy: SessionRuntimeStorePolicy;
}): SessionRuntimePort {
  return new SessionRuntimeStore(params.outbox, params.policy);
}

export function createSessionEventOutbox(): SessionEventOutboxPort {
  return new SessionEventOutboxSqliteAdapter();
}

export function createSessionSqliteRepository(params?: {
  clock?: ClockPort;
  policyProvider?: () => SessionSqliteRepositoryPolicy;
}): SessionRepositoryPort {
  return new SessionSqliteRepository({
    clock: params?.clock ?? systemClock,
    ormProvider: getSqliteOrm,
    transactionRunner: withSqliteTransaction,
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
