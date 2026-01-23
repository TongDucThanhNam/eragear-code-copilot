// Agent domain model
import type {
  AgentConfig,
  AgentInput,
} from "../../../shared/types/agent.types";

export class Agent {
  id: string;
  name: string;
  type: "claude" | "codex" | "opencode" | "gemini" | "other";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  projectId?: string | null;
  createdAt: number;
  updatedAt: number;

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.command = config.command;
    this.args = config.args;
    this.env = config.env;
    this.projectId = config.projectId;
    this.createdAt = config.createdAt;
    this.updatedAt = config.updatedAt;
  }

  static create(input: AgentInput): Agent {
    return new Agent({
      id: crypto.randomUUID?.() || `agent-${Date.now()}`,
      name: input.name,
      type: input.type,
      command: input.command,
      args: input.args,
      env: input.env,
      projectId: input.projectId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  toDTO(): AgentConfig {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      command: this.command,
      args: this.args,
      env: this.env,
      projectId: this.projectId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
