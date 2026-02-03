import type {
  StoredMessage,
  StoredSession,
} from "@/shared/types/session.types";

/**
 * Port for session data persistence operations.
 */
export interface SessionRepositoryPort {
  /** Find a session by ID */
  findById(id: string): StoredSession | undefined;
  /** Find all sessions */
  findAll(): StoredSession[];
  /** Save or update a session */
  save(session: StoredSession): void;
  /** Update session status */
  updateStatus(
    id: string,
    status: "running" | "stopped",
    options?: { touchLastActiveAt?: boolean }
  ): void;
  /** Update session metadata */
  updateMetadata(id: string, updates: Partial<StoredSession>): void;
  /** Delete a session */
  delete(id: string): void;
  /** Append a message to a session */
  appendMessage(id: string, message: StoredMessage): void;
  /** Get all messages for a session */
  getMessages(id: string): StoredMessage[];
}
