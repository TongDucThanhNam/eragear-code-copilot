import { callSqliteWorker } from "@/platform/storage/sqlite-worker-client";
import type {
  StoredMessage,
  StoredSession,
} from "@/shared/types/session.types";
import type {
  SessionListPageQuery,
  SessionListPageResult,
  SessionListQuery,
  SessionMessageCompactionInput,
  SessionMessagesPageQuery,
  SessionMessagesPageResult,
  SessionRepositoryPort,
  SessionStorageStats,
} from "../application/ports/session-repository.port";

export class SessionSqliteWorkerRepository implements SessionRepositoryPort {
  findById(id: string, userId: string): Promise<StoredSession | undefined> {
    return callSqliteWorker("session", "findById", [id, userId]);
  }

  findAll(userId: string, query?: SessionListQuery): Promise<StoredSession[]> {
    return callSqliteWorker("session", "findAll", [userId, query]);
  }

  findAllForMaintenance(query?: SessionListQuery): Promise<StoredSession[]> {
    return callSqliteWorker("session", "findAllForMaintenance", [query]);
  }

  findPage(
    userId: string,
    query?: SessionListPageQuery
  ): Promise<SessionListPageResult> {
    return callSqliteWorker("session", "findPage", [userId, query]);
  }

  findPageForMaintenance(
    query?: SessionListPageQuery
  ): Promise<SessionListPageResult> {
    return callSqliteWorker("session", "findPageForMaintenance", [query]);
  }

  countAll(userId: string): Promise<number> {
    return callSqliteWorker("session", "countAll", [userId]);
  }

  create(session: StoredSession): Promise<void> {
    return callSqliteWorker("session", "create", [session]);
  }

  updateStatus(
    id: string,
    userId: string,
    status: "running" | "stopped",
    options?: { touchLastActiveAt?: boolean }
  ): Promise<void> {
    return callSqliteWorker("session", "updateStatus", [
      id,
      userId,
      status,
      options,
    ]);
  }

  updateMetadata(
    id: string,
    userId: string,
    updates: Partial<StoredSession>
  ): Promise<void> {
    return callSqliteWorker("session", "updateMetadata", [id, userId, updates]);
  }

  delete(id: string, userId: string): Promise<void> {
    return callSqliteWorker("session", "delete", [id, userId]);
  }

  appendMessage(
    id: string,
    userId: string,
    message: StoredMessage
  ): Promise<{ appended: true }> {
    return callSqliteWorker("session", "appendMessage", [id, userId, message]);
  }

  getMessagesPage(
    id: string,
    userId: string,
    query: SessionMessagesPageQuery
  ): Promise<SessionMessagesPageResult> {
    return callSqliteWorker("session", "getMessagesPage", [id, userId, query]);
  }

  compactMessages(
    input: SessionMessageCompactionInput
  ): Promise<{ compacted: number }> {
    return callSqliteWorker("session", "compactMessages", [input]);
  }

  getStorageStats(): Promise<SessionStorageStats> {
    return callSqliteWorker("session", "getStorageStats", []);
  }
}
