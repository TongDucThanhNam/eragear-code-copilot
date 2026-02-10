import type {
  StoredMessage,
  StoredSession,
} from "@/shared/types/session.types";

export interface SessionListQuery {
  limit?: number;
  offset?: number;
}

export interface SessionMessagesPageQuery {
  cursor?: number;
  limit?: number;
  includeCompacted?: boolean;
}

export interface SessionMessagesPageResult {
  messages: StoredMessage[];
  nextCursor?: number;
  hasMore: boolean;
}

export interface SessionMessageCompactionInput {
  beforeTimestamp: number;
  batchSize: number;
}

export interface SessionStorageStats {
  dbSizeBytes: number;
  walSizeBytes: number;
  freePages: number;
  sessionCount: number;
  messageCount: number;
  writeQueueDepth: number;
}

/**
 * Port for session data persistence operations.
 */
export interface SessionRepositoryPort {
  /** Find a session by ID */
  findById(id: string, userId: string): Promise<StoredSession | undefined>;
  /** Find all sessions */
  findAll(userId: string, query?: SessionListQuery): Promise<StoredSession[]>;
  /** Find all sessions across users for maintenance workflows */
  findAllForMaintenance(query?: SessionListQuery): Promise<StoredSession[]>;
  /** Count all sessions */
  countAll(userId: string): Promise<number>;
  /** Save or update a session */
  save(session: StoredSession): Promise<void>;
  /** Update session status */
  updateStatus(
    id: string,
    userId: string,
    status: "running" | "stopped",
    options?: { touchLastActiveAt?: boolean }
  ): Promise<void>;
  /** Update session metadata */
  updateMetadata(
    id: string,
    userId: string,
    updates: Partial<StoredSession>
  ): Promise<void>;
  /** Delete a session */
  delete(id: string, userId: string): Promise<void>;
  /** Append a message to a session */
  appendMessage(id: string, userId: string, message: StoredMessage): Promise<void>;
  /** Get a paginated page of messages for a session */
  getMessagesPage(
    id: string,
    userId: string,
    query: SessionMessagesPageQuery
  ): Promise<SessionMessagesPageResult>;
  /** Compact older message payloads to reduce DB growth */
  compactMessages(
    input: SessionMessageCompactionInput
  ): Promise<{ compacted: number }>;
  /** Get storage stats for observability and UI */
  getStorageStats(): Promise<SessionStorageStats>;
}
