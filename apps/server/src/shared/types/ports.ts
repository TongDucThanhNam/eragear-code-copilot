/**
 * Port Interfaces (Adapter Contracts)
 *
 * Port interface definitions for the application's hexagonal architecture.
 * These interfaces define the contracts that adapters must implement.
 *
 * @module shared/types/ports
 */

import type { ChildProcess } from "node:child_process";
import type { Client, ClientSideConnection } from "@agentclientprotocol/sdk";
import type { AgentConfig, AgentInput, AgentUpdateInput } from "./agent.types";
import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "./project.types";
import type {
  ChatSession,
  StoredMessage,
  StoredSession,
} from "./session.types";
import type { Settings } from "./settings.types";

// ============================================================================
// Repository Ports (Persistence)
// ============================================================================

/**
 * Port for session data persistence operations
 */
export interface SessionRepositoryPort {
  /** Find a session by ID */
  findById(id: string): StoredSession | undefined;
  /** Find all sessions */
  findAll(): StoredSession[];
  /** Save or update a session */
  save(session: StoredSession): void;
  /** Update session status */
  updateStatus(id: string, status: "running" | "stopped"): void;
  /** Update session metadata */
  updateMetadata(id: string, updates: Partial<StoredSession>): void;
  /** Delete a session */
  delete(id: string): void;
  /** Append a message to a session */
  appendMessage(id: string, message: StoredMessage): void;
  /** Get all messages for a session */
  getMessages(id: string): StoredMessage[];
}

/**
 * Port for project data persistence operations
 */
export interface ProjectRepositoryPort {
  /** Find a project by ID */
  findById(id: string): Project | undefined;
  /** Find all projects */
  findAll(): Project[];
  /** Get the currently active project ID */
  getActiveId(): string | null;
  /** Create a new project */
  create(input: ProjectInput): Project;
  /** Update an existing project */
  update(input: ProjectUpdateInput): Project;
  /** Delete a project */
  delete(id: string): void;
  /** Set the active project */
  setActive(id: string | null): void;
  /** Set allowed project roots */
  setAllowedRoots(roots: string[]): void;
}

/**
 * Port for agent data persistence operations
 */
export interface AgentRepositoryPort {
  /** Find an agent by ID */
  findById(id: string): AgentConfig | undefined;
  /** Find all agents */
  findAll(): AgentConfig[];
  /** List agents by project */
  listByProject(projectId?: string | null): AgentConfig[];
  /** Create a new agent */
  create(input: AgentInput): AgentConfig;
  /** Update an existing agent */
  update(input: AgentUpdateInput): AgentConfig;
  /** Delete an agent */
  delete(id: string): void;
  /** Set the active agent */
  setActive(id: string | null): void;
}

/**
 * Port for settings persistence operations
 */
export interface SettingsRepositoryPort {
  /** Get current settings */
  get(): Settings;
  /** Update settings with a partial patch */
  update(patch: Partial<Settings>): Settings;
}

// ============================================================================
// Runtime Ports (In-Memory Services)
// ============================================================================

/**
 * Port for runtime session management
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
  /** Broadcast an event to a session's subscribers */
  broadcast(chatId: string, event: unknown): void;
}

/**
 * Port for event bus operations
 */
export interface EventBusPort {
  /** Subscribe to events, returns unsubscribe function */
  subscribe(listener: (event: unknown) => void): () => void;
  /** Publish an event */
  publish(event: unknown): void;
}

// ============================================================================
// Infrastructure Ports (External Systems)
// ============================================================================

/**
 * Port for agent runtime operations
 */
export interface AgentRuntimePort {
  /** Spawn a child process for an agent */
  spawn(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string> }
  ): ChildProcess;
  /** Create an ACP connection from a process */
  createAcpConnection(
    proc: ChildProcess,
    handlers: Client
  ): ClientSideConnection;
}

/**
 * Port for terminal operations
 */
export interface TerminalPort {
  /** Create a new terminal session */
  create(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string> }
  ): Promise<string>;
  /** Wait for terminal exit */
  waitForExit(
    terminalId: string
  ): Promise<{ exitCode: number | null; signal: string | null }>;
  /** Get terminal output */
  getOutput(terminalId: string): string;
  /** Kill a terminal */
  kill(terminalId: string): void;
  /** Release terminal resources */
  release(terminalId: string): void;
}

/**
 * Port for filesystem operations
 */
export interface FileSystemPort {
  /** Read a text file */
  readTextFile(chatId: string, path: string): Promise<string>;
  /** Read specific lines from a text file */
  readTextFileLines(
    chatId: string,
    path: string,
    line?: number,
    limit?: number
  ): Promise<string>;
  /** Write text to a file */
  writeTextFile(chatId: string, path: string, content: string): Promise<void>;
  /** Resolve a path within the session context */
  resolvePathInSession(chatId: string, inputPath: string): Promise<string>;
}

/**
 * Port for git operations
 */
export interface GitPort {
  /** Get project context (rules, tabs, files) */
  getProjectContext(scanRoot: string): Promise<{
    projectRules: { path: string; location: string }[];
    activeTabs: { path: string }[];
    files: string[];
  }>;
  /** Get git diff for a project */
  getDiff(projectRoot: string): Promise<string>;
  /** Read a file within the project root */
  readFileWithinRoot(
    projectRoot: string,
    relativePath: string
  ): Promise<string>;
}
