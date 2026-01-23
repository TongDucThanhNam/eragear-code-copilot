// Port interfaces (contracts for adapters)

import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "../types/agent.types";
import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "../types/project.types";
import type {
  ChatSession,
  StoredMessage,
  StoredSession,
} from "../types/session.types";
import type { Settings } from "../types/settings.types";

export interface SessionRepositoryPort {
  findById(id: string): StoredSession | undefined;
  findAll(): StoredSession[];
  save(session: StoredSession): void;
  updateStatus(id: string, status: "running" | "stopped"): void;
  updateMetadata(id: string, updates: Partial<StoredSession>): void;
  delete(id: string): void;
  appendMessage(id: string, message: StoredMessage): void;
  getMessages(id: string): StoredMessage[];
}

export interface ProjectRepositoryPort {
  findById(id: string): Project | undefined;
  findAll(): Project[];
  getActiveId(): string | null;
  create(input: ProjectInput): Project;
  update(input: ProjectUpdateInput): Project;
  delete(id: string): void;
  setActive(id: string | null): void;
}

export interface AgentRepositoryPort {
  findById(id: string): AgentConfig | undefined;
  findAll(): AgentConfig[];
  listByProject(projectId?: string | null): AgentConfig[];
  create(input: AgentInput): AgentConfig;
  update(input: AgentUpdateInput): AgentConfig;
  delete(id: string): void;
  setActive(id: string | null): void;
}

export interface SettingsRepositoryPort {
  get(): Settings;
  update(patch: Partial<Settings>): Settings;
}

export interface SessionRuntimePort {
  set(chatId: string, session: ChatSession): void;
  get(chatId: string): ChatSession | undefined;
  delete(chatId: string): void;
  has(chatId: string): boolean;
  getAll(): ChatSession[];
  broadcast(chatId: string, event: unknown): void;
}

export interface EventBusPort {
  subscribe(listener: (event: unknown) => void): () => void;
  publish(event: unknown): void;
}

export interface AgentRuntimePort {
  spawn(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string> }
  ): any;
  createAcpConnection(proc: any, handlers: any): any;
}

export interface TerminalPort {
  create(command: string, args: string[], options: any): Promise<string>;
  waitForExit(
    terminalId: string
  ): Promise<{ exitCode: number | null; signal: string | null }>;
  getOutput(terminalId: string): string;
  kill(terminalId: string): void;
  release(terminalId: string): void;
}

export interface FileSystemPort {
  readTextFile(chatId: string, path: string): Promise<string>;
  readTextFileLines(
    chatId: string,
    path: string,
    line?: number,
    limit?: number
  ): Promise<string>;
  writeTextFile(chatId: string, path: string, content: string): Promise<void>;
  resolvePathInSession(chatId: string, inputPath: string): Promise<string>;
}

export interface GitPort {
  getProjectContext(scanRoot: string): Promise<any>;
  getDiff(projectRoot: string): Promise<string>;
  readFileWithinRoot(
    projectRoot: string,
    relativePath: string
  ): Promise<string>;
}
