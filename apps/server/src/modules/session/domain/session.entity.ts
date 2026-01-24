/**
 * Session Domain Entity
 *
 * Core domain model representing a chat session with an AI agent.
 * Encapsulates session lifecycle, state management, and metadata.
 *
 * @module modules/session/domain/session.entity
 */

import type { AgentInfo } from "../../../shared/types/agent.types";
import type {
  AvailableCommand,
  PromptCapabilities,
  SessionModelState,
  SessionModeState,
} from "../../../shared/types/session.types";

/**
 * Session entity representing a running or stopped chat session
 *
 * This is the core domain model for session state management.
 * It tracks the session lifecycle, agent capabilities, and mode/model states.
 *
 * @example
 * ```typescript
 * const session = new Session({
 *   id: "chat-123",
 *   projectRoot: "/home/user/project",
 *   cwd: "/home/user/project"
 * });
 *
 * session.setModes({
 *   currentModeId: "general",
 *   availableModes: [...]
 * });
 * ```
 */
export class Session {
  /** Unique identifier for the session */
  id: string;
  /** Optional project ID this session belongs to */
  projectId?: string;
  /** File system path to the project root directory */
  projectRoot: string;
  /** ACP session identifier for agent state restoration */
  sessionId?: string;
  /** Whether the agent supports session loading */
  loadSessionSupported?: boolean;
  /** Information about the connected agent */
  agentInfo?: AgentInfo;
  /** Capabilities reported by the agent for prompting */
  promptCapabilities?: PromptCapabilities;
  /** Current mode state including available modes */
  modes?: SessionModeState;
  /** Current model state including available models */
  models?: SessionModelState;
  /** Available terminal commands */
  commands?: AvailableCommand[];
  /** Current working directory for the session */
  cwd: string;
  /** Timestamp when the session was created */
  createdAt: number;
  /** Timestamp of last activity */
  lastActiveAt: number;
  /** Current session status */
  status: "running" | "stopped";

  /**
   * Creates a new Session entity
   *
   * @param params - Session initialization parameters
   */
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

  /**
   * Updates the session mode state
   *
   * @param modes - The new mode state including current mode and available modes
   */
  setModes(modes: SessionModeState) {
    this.modes = modes;
    this.lastActiveAt = Date.now();
  }

  /**
   * Updates the session model state
   *
   * @param models - The new model state including current model and available models
   */
  setModels(models: SessionModelState) {
    this.models = models;
    this.lastActiveAt = Date.now();
  }

  /**
   * Sets the prompt capabilities reported by the agent
   *
   * @param capabilities - The prompt capabilities the agent supports
   */
  setPromptCapabilities(capabilities: PromptCapabilities) {
    this.promptCapabilities = capabilities;
  }

  /**
   * Marks the session as stopped
   *
   * Updates the status and refreshes the last activity timestamp.
   */
  stop() {
    this.status = "stopped";
    this.lastActiveAt = Date.now();
  }
}
