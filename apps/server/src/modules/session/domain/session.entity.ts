// Session domain model

import type { AgentInfo } from "../../../shared/types/agent.types";
import type {
  AvailableCommand,
  PromptCapabilities,
  SessionModelState,
  SessionModeState,
} from "../../../shared/types/session.types";

export class Session {
  id: string;
  projectId?: string;
  projectRoot: string;
  sessionId?: string;
  loadSessionSupported?: boolean;
  agentInfo?: AgentInfo;
  promptCapabilities?: PromptCapabilities;
  modes?: SessionModeState;
  models?: SessionModelState;
  commands?: AvailableCommand[];
  cwd: string;
  createdAt: number;
  lastActiveAt: number;
  status: "running" | "stopped";

  constructor(params: {
    id: string;
    projectId?: string;
    projectRoot: string;
    sessionId?: string;
    cwd: string;
    agentInfo?: AgentInfo;
  }) {
    this.id = params.id;
    this.projectId = params.projectId;
    this.projectRoot = params.projectRoot;
    this.sessionId = params.sessionId;
    this.cwd = params.cwd;
    this.agentInfo = params.agentInfo;
    this.createdAt = Date.now();
    this.lastActiveAt = Date.now();
    this.status = "running";
  }

  setModes(modes: SessionModeState) {
    this.modes = modes;
    this.lastActiveAt = Date.now();
  }

  setModels(models: SessionModelState) {
    this.models = models;
    this.lastActiveAt = Date.now();
  }

  setPromptCapabilities(capabilities: PromptCapabilities) {
    this.promptCapabilities = capabilities;
  }

  stop() {
    this.status = "stopped";
    this.lastActiveAt = Date.now();
  }
}
