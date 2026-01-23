// Dependency container - creates and wires all adapters

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
import { EventBus } from "../shared/utils/event-bus";

export class Container {
  private readonly eventBus: EventBusPort;
  private readonly sessionRuntime: SessionRuntimePort;

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

    this.sessionRepo = new SessionJsonRepository();
    this.projectRepo = new ProjectJsonRepository(allowedRoots);
    this.agentRepo = new AgentJsonRepository();

    this.settingsRepo = new SettingsJsonRepository();

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
