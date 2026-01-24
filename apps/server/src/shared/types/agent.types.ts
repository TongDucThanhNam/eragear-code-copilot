/**
 * Agent Types
 *
 * Type definitions for agent configuration, input, and runtime information.
 *
 * @module shared/types/agent.types
 */

/**
 * Basic agent metadata information
 */
export interface AgentInfo {
  /** Display name of the agent */
  name?: string;
  /** Title or description of the agent */
  title?: string;
  /** Version identifier */
  version?: string;
}

/**
 * Complete agent configuration stored in the system
 */
export interface AgentConfig {
  /** Unique identifier for the agent */
  id: string;
  /** Display name of the agent */
  name: string;
  /** Agent type/brand identifier */
  type: "claude" | "codex" | "opencode" | "gemini" | "other";
  /** Command to spawn the agent process */
  command: string;
  /** Optional arguments for the command */
  args?: string[];
  /** Optional environment variables */
  env?: Record<string, string>;
  /** Associated project ID, if any */
  projectId?: string | null;
  /** Timestamp when the agent was created */
  createdAt: number;
  /** Timestamp when the agent was last updated */
  updatedAt: number;
}

/**
 * Input data for creating a new agent
 */
export interface AgentInput {
  /** Display name of the agent */
  name: string;
  /** Agent type/brand identifier */
  type: AgentConfig["type"];
  /** Command to spawn the agent process */
  command: string;
  /** Optional arguments for the command */
  args?: string[];
  /** Optional environment variables */
  env?: Record<string, string>;
  /** Associated project ID, if any */
  projectId?: string | null;
}

/**
 * Input data for updating an existing agent
 */
export interface AgentUpdateInput extends Partial<AgentInput> {
  /** Unique identifier of the agent to update */
  id: string;
}
