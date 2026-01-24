/**
 * Dependency Injection Container
 *
 * Creates and wires all adapters, repositories, and services for the application.
 * Implements the dependency inversion principle by injecting ports (interfaces)
 * with concrete implementations (adapters).
 *
 * @module bootstrap/container
 */

import { FileSystemAdapter } from "../infra/filesystem";
import { GitAdapter } from "../infra/git";
import { AgentRuntimeAdapter } from "../infra/process";
import { AgentJsonRepository } from "../modules/agent/infra/agent.repository.json";
import { ProjectJsonRepository } from "../modules/project/infra/project.repository.json";
import { SessionRuntimeStore } from "../modules/session/infra/runtime-store";
import { SessionJsonRepository } from "../modules/session/infra/session.repository.json";
import { SettingsJsonRepository } from "../modules/settings/infra/ui-settings.repository.json";
import type {
  AgentRepositoryPort,
  AgentRuntimePort,
  EventBusPort,
  FileSystemPort,
  ProjectRepositoryPort,
  SessionRepositoryPort,
  SessionRuntimePort,
  SettingsRepositoryPort,
} from "../shared/types/ports";
import type { Settings } from "../shared/types/settings.types";
import { EventBus } from "../shared/utils/event-bus";

/**
 * Main dependency injection container
 * Provides access to all repositories, adapters, and services in the application
 */
export class Container {
  /** Event bus for cross-session event communication */
  private readonly eventBus: EventBusPort;
  /** Runtime store for active chat sessions */
  private readonly sessionRuntime: SessionRuntimePort;

  // Repositories
  /** Session repository for persisting session metadata and messages */
  sessionRepo: SessionRepositoryPort;
  /** Project repository for managing project configurations */
  projectRepo: ProjectRepositoryPort;
  /** Agent repository for managing agent configurations */
  agentRepo: AgentRepositoryPort;
  /** Settings repository for managing application settings */
  settingsRepo: SettingsRepositoryPort;

  // Adapters
  /** File system adapter for file operations within session context */
  fileSystemAdapter: FileSystemPort;
  /** Git adapter for git operations and project context */
  gitAdapter: GitAdapter;
  /** Agent runtime adapter for spawning and managing agent processes */
  agentRuntimeAdapter: AgentRuntimePort;

  /**
   * Creates a new Container instance
   * @param allowedRoots - Array of allowed project root paths
   */
  constructor(allowedRoots: string[] = [process.cwd()]) {
    // Core services
    this.eventBus = new EventBus();
    this.sessionRuntime = new SessionRuntimeStore(this.eventBus);

    // Initialize repositories
    this.sessionRepo = new SessionJsonRepository();
    this.projectRepo = new ProjectJsonRepository(allowedRoots);
    this.agentRepo = new AgentJsonRepository();
    this.settingsRepo = new SettingsJsonRepository();

    // Initialize adapters
    this.fileSystemAdapter = new FileSystemAdapter(this.sessionRuntime);
    this.gitAdapter = new GitAdapter();
    this.agentRuntimeAdapter = new AgentRuntimeAdapter();
  }

  /**
   * Gets the event bus instance
   * @returns The event bus for publishing and subscribing to events
   */
  getEventBus(): EventBusPort {
    return this.eventBus;
  }

  /**
   * Gets the session runtime store
   * @returns The session runtime port for managing active sessions
   */
  getSessionRuntime(): SessionRuntimePort {
    return this.sessionRuntime;
  }

  /**
   * Gets the session repository
   * @returns The session repository for session persistence
   */
  getSessions(): SessionRepositoryPort {
    return this.sessionRepo;
  }

  /**
   * Gets the project repository
   * @returns The project repository for project management
   */
  getProjects(): ProjectRepositoryPort {
    return this.projectRepo;
  }

  /**
   * Applies new settings and returns which settings changed
   * @param next - The new settings to apply
   * @returns Object containing lists of changed keys and settings requiring restart
   */
  applySettings(next: Settings): {
    requiresRestart: string[];
    changedKeys: string[];
  } {
    const current = this.settingsRepo.get();
    const changedKeys: string[] = [];
    const requiresRestart: string[] = [];

    if (
      JSON.stringify(current.projectRoots) !== JSON.stringify(next.projectRoots)
    ) {
      changedKeys.push("projectRoots");
      this.projectRepo.setAllowedRoots(next.projectRoots);
    }

    if (JSON.stringify(current.ui) !== JSON.stringify(next.ui)) {
      changedKeys.push("ui");
    }

    if (
      JSON.stringify(current.mcpServers ?? []) !==
      JSON.stringify(next.mcpServers ?? [])
    ) {
      changedKeys.push("mcpServers");
      requiresRestart.push("mcpServers");
    }

    return { requiresRestart, changedKeys };
  }

  /**
   * Gets the agent repository
   * @returns The agent repository for agent management
   */
  getAgents(): AgentRepositoryPort {
    return this.agentRepo;
  }

  /**
   * Gets the settings repository
   * @returns The settings repository for accessing settings
   */
  getSettings(): SettingsRepositoryPort {
    return this.settingsRepo;
  }

  /**
   * Gets the agent runtime adapter
   * @returns The agent runtime port for spawning agent processes
   */
  getAgentRuntime(): AgentRuntimePort {
    return this.agentRuntimeAdapter;
  }

  /**
   * Gets the git adapter
   * @returns The git adapter for git operations
   */
  getGit(): GitAdapter {
    return this.gitAdapter;
  }

  /**
   * Gets the file system adapter
   * @returns The file system port for file operations
   */
  getFileSystem(): FileSystemPort {
    return this.fileSystemAdapter;
  }
}

/** Singleton container instance */
let containerInstance: Container | null = null;

/**
 * Initializes the container with optional allowed roots
 * @param allowedRoots - Optional array of allowed project root paths
 * @returns The initialized container instance
 */
export function initializeContainer(allowedRoots?: string[]): Container {
  containerInstance = new Container(allowedRoots);
  return containerInstance;
}

/**
 * Gets the singleton container instance
 * Creates a new instance if one doesn't exist
 * @returns The container instance
 */
export function getContainer(): Container {
  if (!containerInstance) {
    containerInstance = new Container();
  }
  return containerInstance;
}
