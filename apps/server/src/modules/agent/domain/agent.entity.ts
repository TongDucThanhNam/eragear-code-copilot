/**
 * Agent Domain Entity
 *
 * Core domain model representing an AI agent configuration.
 * Encapsulates agent properties and business rules for agent creation and transformation.
 *
 * @module modules/agent/domain/agent.entity
 */

import { randomUUID } from "node:crypto";
import type {
  AgentConfig,
  AgentInput,
} from "../../../shared/types/agent.types";

export class Agent {
  /** Unique identifier for the agent */
  id: string;
  /** Owning user identifier */
  userId: string;
  /** Display name for the agent */
  name: string;
  /** Type of AI model/provider (claude, codex, opencode, gemini, other) */
  type: "claude" | "codex" | "opencode" | "gemini" | "other";
  /** Executable command to launch the agent */
  command: string;
  /** Optional arguments for the command */
  args?: string[];
  /** Optional command template for resuming existing sessions */
  resumeCommandTemplate?: string;
  /** Environment variables for the agent process */
  env?: Record<string, string>;
  /** Optional project ID this agent belongs to */
  projectId?: string | null;
  /** Timestamp when the agent was created */
  createdAt: number;
  /** Timestamp when the agent was last updated */
  updatedAt: number;

  /**
   * Creates an Agent instance from a configuration object
   * @param config - Agent configuration object
   */
  constructor(config: AgentConfig) {
    this.id = config.id;
    this.userId = config.userId;
    this.name = config.name;
    this.type = config.type;
    this.command = config.command;
    this.args = config.args;
    this.resumeCommandTemplate = config.resumeCommandTemplate;
    this.env = config.env;
    this.projectId = config.projectId;
    this.createdAt = config.createdAt;
    this.updatedAt = config.updatedAt;
  }

  /**
   * Factory method to create a new Agent from input data
   *
   * @param input - Agent input data (name, type, command, etc.)
   * @returns A new Agent instance with generated ID and timestamps
   *
   * @example
   * ```typescript
   * const agent = Agent.create({
   *   name: "My Agent",
   *   type: "claude",
   *   command: "claude"
   * });
   * ```
   */
  static create(input: AgentInput): Agent {
    return new Agent({
      id: randomUUID(),
      userId: input.userId,
      name: input.name,
      type: input.type,
      command: input.command,
      args: input.args,
      resumeCommandTemplate: input.resumeCommandTemplate,
      env: input.env,
      projectId: input.projectId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  /**
   * Converts the agent to a DTO representation for storage/transmission
   *
   * @returns Agent configuration object suitable for storage or API responses
   */
  toDTO(): AgentConfig {
    return {
      id: this.id,
      userId: this.userId,
      name: this.name,
      type: this.type,
      command: this.command,
      args: this.args,
      resumeCommandTemplate: this.resumeCommandTemplate,
      env: this.env,
      projectId: this.projectId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
