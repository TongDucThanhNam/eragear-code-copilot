// Dependency container - creates and wires all adapters

import { FileSystemAdapter } from "../infra/filesystem";
import { GitAdapter } from "../infra/git";
import { AgentRuntimeAdapter } from "../infra/process";
import {
  AgentStorageAdapter,
  ProjectStorageAdapter,
  SessionStorageAdapter,
  SettingsStorageAdapter,
} from "../infra/storage";
import { SessionRuntimeStore } from "../modules/session/infra/runtime-store";
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
import { EventBus } from "../shared/utils/event-bus";

export class Container {
  private eventBus: EventBusPort;
  private sessionRuntime: SessionRuntimePort;

  // Repositories
  sessionRepo: SessionRepositoryPort;
  projectRepo: ProjectRepositoryPort;
  agentRepo: AgentRepositoryPort;
  settingsRepo: SettingsRepositoryPort;

  // Adapters
  fileSystemAdapter: FileSystemPort;
  gitAdapter: GitAdapter;
  agentRuntimeAdapter: AgentRuntimePort;

  constructor(allowedRoots: string[] = [process.cwd()]) {
    // Core services
    this.eventBus = new EventBus();
    this.sessionRuntime = new SessionRuntimeStore(this.eventBus);

    // Repositories
    this.sessionRepo = new SessionStorageAdapter();
    this.projectRepo = new ProjectStorageAdapter(allowedRoots);
    this.agentRepo = new AgentStorageAdapter();
    this.settingsRepo = new SettingsStorageAdapter();

    // Adapters
    this.fileSystemAdapter = new FileSystemAdapter(this.sessionRuntime);
    this.gitAdapter = new GitAdapter();
    this.agentRuntimeAdapter = new AgentRuntimeAdapter();
  }

  getEventBus(): EventBusPort {
    return this.eventBus;
  }

  getSessionRuntime(): SessionRuntimePort {
    return this.sessionRuntime;
  }

  getSessions(): SessionRepositoryPort {
    return this.sessionRepo;
  }

  getProjects(): ProjectRepositoryPort {
    return this.projectRepo;
  }

  getAgents(): AgentRepositoryPort {
    return this.agentRepo;
  }

  getSettings(): SettingsRepositoryPort {
    return this.settingsRepo;
  }

  getAgentRuntime(): AgentRuntimePort {
    return this.agentRuntimeAdapter;
  }

  getGit(): GitAdapter {
    return this.gitAdapter;
  }

  getFileSystem(): FileSystemPort {
    return this.fileSystemAdapter;
  }
}

let containerInstance: Container | null = null;

export function initializeContainer(allowedRoots?: string[]): Container {
  containerInstance = new Container(allowedRoots);
  return containerInstance;
}

export function getContainer(): Container {
  if (!containerInstance) {
    containerInstance = new Container();
  }
  return containerInstance;
}
