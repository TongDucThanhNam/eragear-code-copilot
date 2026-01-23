// Common types and utilities
export interface Id {
  type: string;
  value: string;
}

export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

export interface Repository<T> {
  findById(id: string): T | undefined;
  findAll(): T[];
  save(entity: T): void;
  delete(id: string): void;
}

export const EventType = {
  SessionCreated: "session:created",
  SessionStarted: "session:started",
  SessionStopped: "session:stopped",
  SessionDeleted: "session:deleted",
  MessageSent: "message:sent",
  MessageReceived: "message:received",
  ModeChanged: "mode:changed",
  ModelChanged: "model:changed",
  PermissionRequested: "permission:requested",
  TerminalCreated: "terminal:created",
  TerminalOutput: "terminal:output",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export interface DomainEvent {
  type: EventType;
  timestamp: number;
  data: unknown;
}
