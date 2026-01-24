/**
 * Common Types and Utilities
 *
 * Shared type definitions including identifiers, results, repositories,
 * and domain event constants used throughout the application.
 *
 * @module shared/types/common.types
 */

/**
 * Generic identifier structure
 */
export interface Id {
  /** Type of the identifier */
  type: string;
  /** String value of the identifier */
  value: string;
}

/**
 * Result type for operations that can succeed or fail
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Generic repository interface for CRUD operations
 */
export interface Repository<T> {
  /** Find an entity by its ID */
  findById(id: string): T | undefined;
  /** Find all entities */
  findAll(): T[];
  /** Save an entity */
  save(entity: T): void;
  /** Delete an entity by ID */
  delete(id: string): void;
}

/**
 * Domain event type constants
 */
export const EventType = {
  /** A new session was created */
  SessionCreated: "session:created",
  /** A session was started */
  SessionStarted: "session:started",
  /** A session was stopped */
  SessionStopped: "session:stopped",
  /** A session was deleted */
  SessionDeleted: "session:deleted",
  /** A message was sent */
  MessageSent: "message:sent",
  /** A message was received */
  MessageReceived: "message:received",
  /** The session mode was changed */
  ModeChanged: "mode:changed",
  /** The session model was changed */
  ModelChanged: "model:changed",
  /** A permission was requested */
  PermissionRequested: "permission:requested",
  /** A terminal was created */
  TerminalCreated: "terminal:created",
  /** Terminal output was received */
  TerminalOutput: "terminal:output",
} as const;

/** Type derived from EventType values */
export type EventType = (typeof EventType)[keyof typeof EventType];

/**
 * Domain event structure
 */
export interface DomainEvent {
  /** Type of the event */
  type: EventType;
  /** Timestamp when the event occurred */
  timestamp: number;
  /** Event payload data */
  data: unknown;
}
