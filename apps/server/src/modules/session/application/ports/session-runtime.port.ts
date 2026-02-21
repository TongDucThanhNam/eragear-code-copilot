import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";

export interface SessionBroadcastOptions {
  /** Persist to durable outbox for eventual cross-component fan-out. */
  durable?: boolean;
  /** Retain in in-memory replay buffer for late subscribers/reconnect. */
  retainInBuffer?: boolean;
}

/**
 * Port for runtime session management.
 */
export interface SessionRuntimePort {
  /** Set a session in the runtime store */
  set(chatId: string, session: ChatSession): void;
  /** Get a session from the runtime store */
  get(chatId: string): ChatSession | undefined;
  /** Delete a session from the runtime store */
  delete(chatId: string): void;
  /**
   * Delete only when the currently registered runtime matches the expected
   * object identity. Prevents stale async cleanups from deleting a newer
   * session that reused the same chat id.
   */
  deleteIfMatch(chatId: string, expectedSession: ChatSession): boolean;
  /** Check if a session exists */
  has(chatId: string): boolean;
  /** Get all active sessions */
  getAll(): ChatSession[];
  /** Execute work under a per-chat exclusive lock */
  runExclusive<T>(chatId: string, work: () => Promise<T>): Promise<T>;
  /** Returns true when the current async flow holds the per-chat lock */
  isLockHeld(chatId: string): boolean;
  /** Broadcast an event locally and enqueue durable outbox fan-out */
  broadcast(
    chatId: string,
    event: BroadcastEvent,
    options?: SessionBroadcastOptions
  ): Promise<void>;
}
