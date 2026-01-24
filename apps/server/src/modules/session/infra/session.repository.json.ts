/**
 * Session Repository (JSON-backed)
 *
 * Persistent storage implementation for sessions using JSON file storage.
 * Provides CRUD operations for session metadata and message history.
 *
 * @module modules/session/infra/session.repository.json
 */

import { readJsonFile, writeJsonFile } from "../../../infra/storage/json-store";
import type { SessionRepositoryPort } from "../../../shared/types/ports";
import type {
  StoredMessage,
  StoredSession,
} from "../../../shared/types/session.types";

/** Path to the sessions JSON file */
const SESSIONS_FILE = "sessions.json";

/**
 * SessionJsonRepository
 *
 * JSON file-backed implementation of SessionRepositoryPort.
 * Persists session metadata and messages to a JSON file.
 *
 * Thread safety is provided by the underlying JSON store operations.
 *
 * @example
 * ```typescript
 * const repo = new SessionJsonRepository();
 * const session = repo.findById("chat-123");
 * if (session) {
 *   console.log("Found session:", session.projectRoot);
 * }
 * ```
 */
export class SessionJsonRepository implements SessionRepositoryPort {
  /**
   * Reads all sessions from the JSON file
   *
   * @returns Array of stored sessions, or empty array if file doesn't exist
   */
  private getSessions(): StoredSession[] {
    return readJsonFile(SESSIONS_FILE, []);
  }

  /**
   * Writes all sessions to the JSON file
   *
   * @param sessions - Array of sessions to persist
   */
  private saveSessions(sessions: StoredSession[]): void {
    writeJsonFile(SESSIONS_FILE, sessions);
  }

  /**
   * Finds a session by its ID
   *
   * @param id - The session identifier
   * @returns The session if found, undefined otherwise
   */
  findById(id: string): StoredSession | undefined {
    const sessions = this.getSessions();
    return sessions.find((s) => s.id === id);
  }

  /**
   * Retrieves all stored sessions
   *
   * @returns Array of all sessions
   */
  findAll(): StoredSession[] {
    return this.getSessions();
  }

  /**
   * Saves or updates a session
   *
   * If a session with the same ID exists, it will be replaced.
   * Otherwise, the session is added to the collection.
   *
   * @param session - The session to save
   */
  save(session: StoredSession): void {
    const sessions = this.getSessions();
    const existingIndex = sessions.findIndex((s) => s.id === session.id);

    if (existingIndex >= 0) {
      sessions[existingIndex] = session;
    } else {
      sessions.push(session);
    }

    this.saveSessions(sessions);
  }

  /**
   * Updates only the status of a session
   *
   * @param id - The session identifier
   * @param status - The new status value
   */
  updateStatus(id: string, status: "running" | "stopped"): void {
    const sessions = this.getSessions();
    const session = sessions.find((s) => s.id === id);
    if (session) {
      session.status = status;
      session.lastActiveAt = Date.now();
      this.saveSessions(sessions);
    }
  }

  /**
   * Updates session metadata with the provided updates
   *
   * @param id - The session identifier
   * @param updates - Partial session data to update
   */
  updateMetadata(id: string, updates: Partial<StoredSession>): void {
    const sessions = this.getSessions();
    const session = sessions.find((s) => s.id === id);
    if (session) {
      Object.assign(session, updates);
      session.lastActiveAt = Date.now();
      this.saveSessions(sessions);
    }
  }

  /**
   * Deletes a session by ID
   *
   * @param id - The session identifier to delete
   */
  delete(id: string): void {
    const sessions = this.getSessions();
    const newSessions = sessions.filter((s) => s.id !== id);
    this.saveSessions(newSessions);
  }

  /**
   * Appends a message to a session's message history
   *
   * @param id - The session identifier
   * @param message - The message to append
   */
  appendMessage(id: string, message: StoredMessage): void {
    const sessions = this.getSessions();
    const session = sessions.find((s) => s.id === id);
    if (session) {
      if (!session.messages) {
        session.messages = [];
      }
      session.messages.push(message);
      session.lastActiveAt = Date.now();
      this.saveSessions(sessions);
    }
  }

  /**
   * Retrieves all messages for a session
   *
   * @param id - The session identifier
   * @returns Array of stored messages in chronological order
   */
  getMessages(id: string): StoredMessage[] {
    const session = this.findById(id);
    return session?.messages ?? [];
  }
}
