import type { ChatSession } from "@/shared/types/session.types";

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
  /** Check if a session exists */
  has(chatId: string): boolean;
  /** Get all active sessions */
  getAll(): ChatSession[];
  /** Execute work under a per-chat exclusive lock */
  runExclusive<T>(chatId: string, work: () => Promise<T>): Promise<T>;
  /** Broadcast an event locally and enqueue durable outbox fan-out */
  broadcast(chatId: string, event: unknown): Promise<void>;
}
