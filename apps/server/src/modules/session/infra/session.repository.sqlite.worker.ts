import { callSqliteWorker } from "@/platform/storage/sqlite-worker-client";
import type {
  StoredMessage,
  StoredSession,
} from "@/shared/types/session.types";
import type {
  SessionListQuery,
  SessionMessageCompactionInput,
  SessionMessagesPageQuery,
  SessionMessagesPageResult,
  SessionRepositoryPort,
  SessionStorageStats,
} from "../application/ports/session-repository.port";

export class SessionSqliteWorkerRepository implements SessionRepositoryPort {
  findById(id: string): Promise<StoredSession | undefined> {
    return callSqliteWorker("session", "findById", [id]);
  }

  findAll(query?: SessionListQuery): Promise<StoredSession[]> {
    return callSqliteWorker("session", "findAll", [query]);
  }

  countAll(): Promise<number> {
    return callSqliteWorker("session", "countAll", []);
  }

  save(session: StoredSession): Promise<void> {
    return callSqliteWorker("session", "save", [session]);
  }

  updateStatus(
    id: string,
    status: "running" | "stopped",
    options?: { touchLastActiveAt?: boolean }
  ): Promise<void> {
    return callSqliteWorker("session", "updateStatus", [id, status, options]);
  }

  updateMetadata(id: string, updates: Partial<StoredSession>): Promise<void> {
    return callSqliteWorker("session", "updateMetadata", [id, updates]);
  }

  delete(id: string): Promise<void> {
    return callSqliteWorker("session", "delete", [id]);
  }

  appendMessage(id: string, message: StoredMessage): Promise<void> {
    return callSqliteWorker("session", "appendMessage", [id, message]);
  }

  getMessagesPage(
    id: string,
    query: SessionMessagesPageQuery
  ): Promise<SessionMessagesPageResult> {
    return callSqliteWorker("session", "getMessagesPage", [id, query]);
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
