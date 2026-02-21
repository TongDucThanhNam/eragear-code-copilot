import type {
  StoredMessage,
  StoredSession,
} from "@/modules/session/domain/stored-session.types";

export interface SessionListQuery {
  limit?: number;
  offset?: number;
}

export interface SessionListPageQuery {
  limit?: number;
  cursor?: string;
}

export interface SessionListPageResult {
  sessions: StoredSession[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface SessionMessagesPageQuery {
  cursor?: number;
  direction?: "forward" | "backward";
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
  sessionIds: string[];
}

export interface SessionStorageStats {
  dbSizeBytes: number;
  walSizeBytes: number;
  freePages: number;
  sessionCount: number;
  messageCount: number;
  writeQueueDepth: number;
  pendingWriteQueueTotal?: number;
  pendingWriteQueueHigh?: number;
  pendingWriteQueueLow?: number;
  writeQueueFailures?: number;
  workerRecycleCount?: number;
  workerTimeoutCount?: number;
  workerLastRecycleReason?: string | null;
  workerLastRecycleAt?: number | null;
}

/**
 * Port for session data persistence operations.
 */
export interface SessionRepositoryPort {
  /** Find a session by ID */
  findById(id: string, userId: string): Promise<StoredSession | undefined>;
  /** Find all sessions (offset pagination, compatibility path). */
  findAll(userId: string, query?: SessionListQuery): Promise<StoredSession[]>;
  /** Find all sessions across users for maintenance workflows (compatibility path). */
  findAllForMaintenance(query?: SessionListQuery): Promise<StoredSession[]>;
  /** Find paginated sessions by cursor for primary list path. */
  findPage(
    userId: string,
    query?: SessionListPageQuery
  ): Promise<SessionListPageResult>;
  /** Find maintenance sessions by cursor. */
  findPageForMaintenance(
    query?: SessionListPageQuery
  ): Promise<SessionListPageResult>;
  /** Count all sessions */
  countAll(userId: string): Promise<number>;
  /** Create a new session row (insert-only). */
  create(session: StoredSession): Promise<void>;
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
  appendMessage(
    id: string,
    userId: string,
    message: StoredMessage
  ): Promise<{ appended: true }>;
  /** Get one message by message id for a session */
  getMessageById(
    id: string,
    userId: string,
    messageId: string
  ): Promise<StoredMessage | undefined>;
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
