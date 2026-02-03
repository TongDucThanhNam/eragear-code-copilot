/**
 * Dependency Injection Container
 *
 * Creates and wires all adapters, repositories, and services for the application.
 * Implements the dependency inversion principle by injecting ports (interfaces)
 * with concrete implementations (adapters).
 *
 * @module bootstrap/container
 */

import type { AgentRepositoryPort } from "@/modules/agent/application/ports/agent-repository.port";
import type { ProjectRepositoryPort } from "@/modules/project/application/ports/project-repository.port";
import type { AgentRuntimePort } from "@/modules/session/application/ports/agent-runtime.port";
import type { SessionAcpPort } from "@/modules/session/application/ports/session-acp.port";
import type { SessionRepositoryPort } from "@/modules/session/application/ports/session-repository.port";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import type { SettingsRepositoryPort } from "@/modules/settings/application/ports/settings-repository.port";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import { SessionAcpAdapter } from "../infra/acp/session-acp.adapter";
import { auth, authDb } from "../infra/auth/auth";
import { getAuthContext } from "../infra/auth/guards";
import { GitAdapter } from "../infra/git";
import { getLogStore } from "../infra/logging/log-store";
import { AgentRuntimeAdapter } from "../infra/process";
import { AgentJsonRepository } from "../modules/agent/infra/agent.repository.json";
import { ProjectJsonRepository } from "../modules/project/infra/project.repository.json";
import { SessionRuntimeStore } from "../modules/session/infra/runtime-store";
import { SessionJsonRepository } from "../modules/session/infra/session.repository.json";
import { SettingsJsonRepository } from "../modules/settings/infra/ui-settings.repository.json";
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
  /** Log store for server and request logs */
  private readonly logStore: LogStorePort;

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
  /** Git adapter for git operations and project context */
  gitAdapter: GitAdapter;
  /** Agent runtime adapter for spawning and managing agent processes */
  agentRuntimeAdapter: AgentRuntimePort;
  /** ACP session adapter for ACP handlers and buffering */
  sessionAcpAdapter: SessionAcpPort;

  /**
   * Creates a new Container instance
   * @param allowedRoots - Array of allowed project root paths
   */
  constructor(allowedRoots: string[] = [process.cwd()]) {
    // Core services
    this.eventBus = new EventBus();
    this.sessionRuntime = new SessionRuntimeStore(this.eventBus);
    this.logStore = getLogStore();

    // Initialize repositories
    this.sessionRepo = new SessionJsonRepository();
    this.projectRepo = new ProjectJsonRepository(allowedRoots);
    this.agentRepo = new AgentJsonRepository();
    this.settingsRepo = new SettingsJsonRepository();

    // Initialize adapters
    this.gitAdapter = new GitAdapter();
    this.agentRuntimeAdapter = new AgentRuntimeAdapter();
    this.sessionAcpAdapter = new SessionAcpAdapter();
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
   * Gets the log store instance
   * @returns The log store for log retrieval
   */
  getLogStore(): LogStorePort {
    return this.logStore;
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
   * Gets the ACP session adapter
   * @returns The ACP session adapter
   */
  getSessionAcp(): SessionAcpPort {
    return this.sessionAcpAdapter;
  }

  /**
   * Gets the git adapter
   * @returns The git adapter for git operations
   */
  getGit(): GitAdapter {
    return this.gitAdapter;
  }

  /**
   * Gets the auth service instance
   * @returns The auth service for authentication operations
   */
  getAuth() {
    return auth;
  }

  /**
   * Gets the auth database instance
   * @returns The database for auth queries
   */
  getAuthDb() {
    return authDb;
  }

  /**
   * Resolves auth context from a request-like object
   * @param req - Request-like object containing headers and URL
   * @returns The resolved auth context or null
   */
  getAuthContext(req?: Parameters<typeof getAuthContext>[0]) {
    return getAuthContext(req);
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
