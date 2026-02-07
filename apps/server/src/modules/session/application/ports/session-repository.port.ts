import type {
  StoredMessage,
  StoredSession,
} from "@/shared/types/session.types";

export interface SessionListQuery {
  limit?: number;
  offset?: number;
}

/**
 * Port for session data persistence operations.
 */
export interface SessionRepositoryPort {
  /** Find a session by ID */
  findById(id: string): Promise<StoredSession | undefined>;
  /** Find all sessions */
  findAll(query?: SessionListQuery): Promise<StoredSession[]>;
  /** Count all sessions */
  countAll(): Promise<number>;
  /** Save or update a session */
  save(session: StoredSession): Promise<void>;
  /** Update session status */
  updateStatus(
    id: string,
    status: "running" | "stopped",
    options?: { touchLastActiveAt?: boolean }
  ): Promise<void>;
  /** Update session metadata */
  updateMetadata(id: string, updates: Partial<StoredSession>): Promise<void>;
  /** Delete a session */
  delete(id: string): Promise<void>;
  /** Append a message to a session */
  appendMessage(id: string, message: StoredMessage): Promise<void>;
  /** Get all messages for a session */
  getMessages(id: string): Promise<StoredMessage[]>;
}
