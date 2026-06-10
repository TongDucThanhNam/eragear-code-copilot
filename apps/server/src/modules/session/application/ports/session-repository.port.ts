import type {
  StoredMessage,
  StoredSession,
} from "@/modules/session/domain/stored-session.types";

/**
 * Offset pagination query kept for compatibility callers.
 *
 * Caller contract: new list paths should prefer cursor pagination because
 * offset scans become unstable and expensive on large session stores.
 */
export interface SessionListQuery {
  limit?: number;
  offset?: number;
}

/**
 * Cursor pagination query for primary session list reads.
 *
 * Invariant: cursors are adapter-owned opaque values; callers must not parse or
 * synthesize them.
 */
export interface SessionListPageQuery {
  limit?: number;
  cursor?: string;
}

/**
 * Cursor-paginated session list result.
 *
 * Caller contract: `hasMore` is authoritative; `nextCursor` may be absent when
 * no further page can be requested.
 */
export interface SessionListPageResult {
  sessions: StoredSession[];
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Cursor query for persisted message history.
 *
 * Invariant: `includeCompacted` controls redacted/compacted payload visibility
 * only; it must not resurrect payloads removed by retention policy.
 */
export interface SessionMessagesPageQuery {
  cursor?: number;
  direction?: "forward" | "backward";
  limit?: number;
  includeCompacted?: boolean;
}

/**
 * Persisted message page in chronological display order.
 *
 * Caller contract: returned messages are storage records and still need mapping
 * to UI messages before crossing the transport boundary.
 */
export interface SessionMessagesPageResult {
  messages: StoredMessage[];
  nextCursor?: number;
  hasMore: boolean;
}

/**
 * Message compaction request for cold retention cleanup.
 *
 * Side effect: adapters may rewrite message payload columns but must keep
 * message identity, role, and timestamps stable.
 */
export interface SessionMessageCompactionInput {
  beforeTimestamp: number;
  batchSize: number;
  sessionIds: string[];
}

/**
 * SQLite/storage health snapshot surfaced to ops views.
 *
 * Invariant: queue and worker metrics are best-effort observability data and
 * should not be used as persistence correctness checks.
 */
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
 * Session persistence port.
 *
 * Invariants: every user-scoped method must enforce `userId`; message writes
 * must be atomic per session; maintenance methods are cross-user and must be
 * used only by background/lifecycle code.
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
  /** Replace the full message snapshot for a session atomically */
  replaceMessages(
    id: string,
    userId: string,
    messages: StoredMessage[]
  ): Promise<{ replaced: true }>;
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
