/**
 * Create Session Service
 *
 * Orchestrates the initialization of a new chat session with an AI agent.
 * Handles process spawning, ACP protocol initialization, and session metadata setup.
 *
 * @module modules/session/application/create-session.service
 */

// CreateSessionService - orchestrates session initialization
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type * as acp from "@agentclientprotocol/sdk";
import type { SettingsRepositoryPort } from "@/modules/settings/application/ports/settings-repository.port";
import { CLIENT_INFO } from "../../../config/constants";
import type {
  ChatSession,
  StoredMessage,
} from "../../../shared/types/session.types";
import type {
  McpHttpServerConfig,
  McpServerConfig,
  McpSseServerConfig,
  McpStdioServerConfig,
} from "../../../shared/types/settings.types";
import { terminateSessionTerminals } from "../../../shared/utils/session-cleanup.util";
import type { AgentRuntimePort } from "./ports/agent-runtime.port";
import type {
  SessionAcpPort,
  SessionBufferingPort,
} from "./ports/session-acp.port";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

/**
 * Parameters for creating a new session
 */
export interface CreateSessionParams {
  /** Optional project ID this session belongs to */
  projectId?: string;
  /** File system path to the project root directory */
  projectRoot: string;
  /** Command to spawn the agent process (defaults to "opencode") */
  command?: string;
  /** Arguments to pass to the agent command */
  args?: string[];
  /** Environment variables for the agent process */
  env?: Record<string, string>;
  /** Optional predefined chat ID */
  chatId?: string;
  /** Session ID to load (for resuming existing sessions) */
  sessionIdToLoad?: string;
}

/**
 * CreateSessionService
 *
 * Core service for establishing new chat sessions with AI agents.
 * Coordinates between the ACP protocol, session repository, and agent runtime.
 *
 * Responsibilities:
 * - Spawning the agent process with appropriate environment
 * - Initializing ACP protocol connection
 * - Handling session creation vs session loading
 * - Configuring MCP servers
 * - Saving session metadata to persistent storage
 */
export class CreateSessionService {
  /** Repository for session persistence */
  private readonly sessionRepo: SessionRepositoryPort;
  /** Runtime store for active sessions */
  private readonly sessionRuntime: SessionRuntimePort;
  /** Agent process runtime for spawning and managing processes */
  private readonly agentRuntime: AgentRuntimePort;
  /** Repository for application settings including MCP servers */
  private readonly settingsRepo: SettingsRepositoryPort;
  /** ACP session adapter */
  private readonly sessionAcp: SessionAcpPort;

  /**
   * Creates a CreateSessionService with required dependencies
   */
  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    agentRuntime: AgentRuntimePort,
    settingsRepo: SettingsRepositoryPort,
    sessionAcp: SessionAcpPort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.agentRuntime = agentRuntime;
    this.settingsRepo = settingsRepo;
    this.sessionAcp = sessionAcp;
  }

  /**
   * Converts internal MCP server configurations to ACP format
   *
   * @param mcpServers - Array of internal MCP server configurations
   * @returns Array of ACP-formatted MCP server objects
   */
  private convertMcpServersToAcpFormat(
    mcpServers: McpServerConfig[]
  ): acp.McpServer[] {
    return mcpServers.map((server) => {
      if (this.isHttpServer(server)) {
        const httpServer = server as McpHttpServerConfig;
        return {
          type: "http" as const,
          name: httpServer.name,
          url: httpServer.url,
          headers: httpServer.headers,
        } as acp.McpServer;
      }
      if (this.isSseServer(server)) {
        const sseServer = server as McpSseServerConfig;
        return {
          type: "sse" as const,
          name: sseServer.name,
          url: sseServer.url,
          headers: sseServer.headers,
        } as acp.McpServer;
      }
      // Stdio server
      const stdioServer = server as McpStdioServerConfig;
      return {
        name: stdioServer.name,
        command: stdioServer.command,
        args: stdioServer.args,
        env: stdioServer.env,
      } as acp.McpServer;
    });
  }

  /**
   * Type guard for HTTP MCP servers
   */
  private isHttpServer(server: McpServerConfig): server is McpHttpServerConfig {
    return "type" in server && server.type === "http";
  }

  /**
   * Type guard for SSE MCP servers
   */
  private isSseServer(server: McpServerConfig): server is McpSseServerConfig {
    return "type" in server && server.type === "sse";
  }

  /**
   * Initializes the ACP protocol connection with the agent
   *
   * @param chatSession - The session being initialized
   * @param chatId - The chat session identifier
   * @returns Agent capabilities from the initialization response
   * @throws Error if protocol version mismatch
   */
  private async initializeConnection(chatSession: ChatSession, chatId: string) {
    const initResult = await chatSession.conn.initialize({
      protocolVersion: 1,
      clientInfo: CLIENT_INFO,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },

        terminal: true,
      },
    });

    // DEBUG: Log full initialize response
    console.log(
      `[DEBUG] Initialize response for ${chatId}:`,
      JSON.stringify(initResult, null, 2)
    );
    console.log(
      "[DEBUG] agentCapabilities:",
      JSON.stringify(initResult?.agentCapabilities, null, 2)
    );
    console.log(
      "[DEBUG] loadSession raw value:",
      initResult?.agentCapabilities?.loadSession,
      `(type: ${typeof initResult?.agentCapabilities?.loadSession})`
    );

    if (initResult.protocolVersion !== 1) {
      this.sessionRuntime.delete(chatId);
      chatSession.proc.kill();
      throw new Error(
        `Agent protocol version mismatch: ${initResult.protocolVersion}`
      );
    }

    const agentCapabilities = initResult?.agentCapabilities;
    chatSession.promptCapabilities =
      agentCapabilities?.promptCapabilities ?? {};

    // Check for both loadSession (standard) and sessionCapabilities.resume (unstable)
    const hasLoadSession = Boolean(agentCapabilities?.loadSession);
    const sessionCapabilities = (
      agentCapabilities as { sessionCapabilities?: Record<string, unknown> }
    )?.sessionCapabilities;
    const hasResumeCapability = Boolean(sessionCapabilities?.resume);

    // Support resume if either capability is present
    chatSession.loadSessionSupported = hasLoadSession || hasResumeCapability;
    // Track which method to use
    chatSession.useUnstableResume = !hasLoadSession && hasResumeCapability;

    // Check if agent supports runtime model switching (unstable session/set_model method)
    // This is different from returning models in session response - that just lists available models
    const hasSetModelCapability = Boolean(sessionCapabilities?.setModel);
    chatSession.supportsModelSwitching = hasSetModelCapability;

    console.log(
      "[DEBUG] loadSession:",
      hasLoadSession,
      "sessionCapabilities.resume:",
      hasResumeCapability,
      "loadSessionSupported:",
      chatSession.loadSessionSupported,
      "useUnstableResume:",
      chatSession.useUnstableResume,
      "supportsModelSwitching:",
      chatSession.supportsModelSwitching
    );

    chatSession.agentInfo = initResult?.agentInfo
      ? {
        name: initResult.agentInfo.name,
        title: initResult.agentInfo.title ?? undefined,
        version: initResult.agentInfo.version,
      }
      : undefined;

    // Store full capabilities and auth methods for debugging
    chatSession.agentCapabilities = agentCapabilities;
    chatSession.authMethods = initResult?.authMethods as
      | Array<{ name: string; id: string; description: string }>
      | undefined;

    console.log("[DEBUG] agentInfo:", chatSession.agentInfo);

    return agentCapabilities;
  }

  /**
   * Handles loading an existing session from the agent
   *
   * @param chatSession - The session being loaded
   * @param chatId - The chat session identifier
   * @param params - Session creation parameters
   * @param projectRoot - Project root directory
   * @param buffer - Session buffering state
   * @param mcpServers - Configured MCP servers
   */
  private async handleSessionLoad(
    chatSession: ChatSession,
    chatId: string,
    params: CreateSessionParams,
    projectRoot: string,
    buffer: SessionBufferingPort,
    mcpServers: McpServerConfig[]
  ) {
    try {
      let loadResult: {
        modes?: typeof chatSession.modes | null;
        models?: typeof chatSession.models | null;
      };

      if (chatSession.useUnstableResume) {
        // Use unstable_resumeSession for agents with sessionCapabilities.resume
        console.log(
          "[DEBUG] Using unstable_resumeSession for session:",
          params.sessionIdToLoad
        );
        const conn = chatSession.conn as unknown as {
          unstable_resumeSession: (params: {
            sessionId: string;
            cwd: string;
            mcpServers: acp.McpServer[];
          }) => Promise<{
            modes?: typeof chatSession.modes;
            models?: typeof chatSession.models;
          }>;
        };
        loadResult = await conn.unstable_resumeSession({
          sessionId: params.sessionIdToLoad ?? "",
          cwd: projectRoot,
          mcpServers: this.convertMcpServersToAcpFormat(mcpServers),
        });
      } else {
        // Use standard loadSession for agents with loadSession capability
        console.log(
          "[DEBUG] Using loadSession for session:",
          params.sessionIdToLoad
        );
        loadResult = await chatSession.conn.loadSession({
          sessionId: params.sessionIdToLoad ?? "",
          cwd: projectRoot,
          mcpServers: this.convertMcpServersToAcpFormat(mcpServers),
        });
      }

      chatSession.modes = loadResult.modes ?? undefined;
      chatSession.models = loadResult.models ?? undefined;

      const currentModeId = chatSession.modes?.currentModeId;
      if (currentModeId) {
        this.sessionRuntime.broadcast(chatId, {
          type: "current_mode_update",
          modeId: currentModeId,
        });
      }

      this.broadcastPromptEnd(chatId, buffer);
    } catch (err) {
      this.sessionRuntime.delete(chatId);
      chatSession.proc.kill();
      throw err;
    }
  }

  /**
   * Handles creating a new session with the agent
   *
   * @param chatSession - The session being created
   * @param chatId - The chat session identifier
   * @param projectRoot - Project root directory
   * @param mcpServers - Configured MCP servers
   */
  private async handleNewSession(
    chatSession: ChatSession,
    chatId: string,
    projectRoot: string,
    mcpServers: McpServerConfig[]
  ) {
    const newResult = await chatSession.conn.newSession({
      cwd: projectRoot,
      mcpServers: this.convertMcpServersToAcpFormat(mcpServers),
    });
    chatSession.sessionId = newResult.sessionId;
    chatSession.modes = newResult.modes ?? undefined;
    chatSession.models = newResult.models ?? undefined;
    if (chatSession.modes?.currentModeId) {
      this.sessionRuntime.broadcast(chatId, {
        type: "current_mode_update",
        modeId: chatSession.modes.currentModeId,
      });
    }
    this.sessionRuntime.set(chatId, chatSession);
  }

  /**
   * Broadcasts prompt end and replays stored messages if needed
   *
   * @param chatId - The chat session identifier
   * @param buffer - Session buffering state
   */
  private broadcastPromptEnd(chatId: string, buffer: SessionBufferingPort) {
    if (buffer.replayEventCount === 0) {
      this.replayStoredMessages(chatId);
    }
    this.sessionRuntime.broadcast(chatId, {
      type: "session_update",
      update: { sessionUpdate: "prompt_end" },
    });
  }

  /**
   * Saves session metadata to the repository
   *
   * @param chatId - The chat session identifier
   * @param params - Session creation parameters
   * @param chatSession - The session object
   * @param agentCmd - Agent command
   * @param agentArgs - Agent arguments
   * @param agentEnv - Agent environment variables
   * @param projectRoot - Project root directory
   */
  private saveSessionMetadata(
    chatId: string,
    params: CreateSessionParams,
    chatSession: ChatSession,
    agentCmd: string,
    agentArgs: string[],
    agentEnv: Record<string, string>,
    projectRoot: string
  ) {
    const commonSessionData = {
      projectId: params.projectId,
      projectRoot,
      command: agentCmd,
      args: agentArgs,
      env: agentEnv,
      cwd: projectRoot,
      agentInfo: chatSession.agentInfo,
      loadSessionSupported: chatSession.loadSessionSupported,
      useUnstableResume: chatSession.useUnstableResume,
      supportsModelSwitching: chatSession.supportsModelSwitching,
      agentCapabilities: chatSession.agentCapabilities,
      authMethods: chatSession.authMethods,
      status: "running" as const,
      modeId: chatSession.modes?.currentModeId,
      modelId: chatSession.models?.currentModelId,
    };

    if (params.sessionIdToLoad) {
      this.sessionRepo.updateMetadata(chatId, {
        sessionId: chatSession.sessionId,
        ...commonSessionData,
      });
    } else {
      this.sessionRepo.save({
        id: chatId,
        sessionId: chatSession.sessionId,
        ...commonSessionData,
        pinned: false,
        archived: false,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        messages: [],
      });
    }
  }

  /**
   * Executes the session creation process
   *
   * @param params - Session creation parameters
   * @returns The created ChatSession
   * @throws Error if agent doesn't support required features or MCP transport
   */
  async execute(params: CreateSessionParams): Promise<ChatSession> {
    // DEBUG: Log params received
    console.log(
      "[DEBUG] CreateSession params:",
      JSON.stringify(params, null, 2)
    );

    const chatId = params.chatId ?? crypto.randomUUID();
    const agentCmd = params.command ?? "opencode";
    const agentArgs = params.args ?? ["acp"];
    const agentEnv = params.env ?? {};
    const projectRoot = this.resolveProjectRoot(params.projectRoot);

    console.log(
      `[DEBUG] Using agent: command="${agentCmd}", args=${JSON.stringify(agentArgs)}`
    );

    // Spawn process
    const proc = this.agentRuntime.spawn(agentCmd, agentArgs, {
      cwd: projectRoot,
      env: agentEnv,
    });

    const buffer = this.sessionAcp.createBuffer();
    const storedPlan = params.chatId
      ? this.sessionRepo.findById(chatId)?.plan
      : undefined;

    // Create runtime session
    const chatSession: ChatSession = {
      id: chatId,
      proc,
      conn: null as unknown as ChatSession["conn"],
      projectId: params.projectId,
      projectRoot,
      sessionId: params.sessionIdToLoad,
      plan: storedPlan,
      emitter: new EventEmitter(),
      cwd: projectRoot,
      subscriberCount: 0,
      messageBuffer: [],
      pendingPermissions: new Map(),
      toolCalls: new Map(),
      terminals: new Map(),
      buffer,
    };

    // Store in runtime before ACP hooks
    this.sessionRuntime.set(chatId, chatSession);

    if (chatSession.plan) {
      this.sessionRuntime.broadcast(chatId, {
        type: "plan_update",
        plan: chatSession.plan,
      });
    }

    const handlers = this.sessionAcp.createHandlers({
      chatId,
      buffer,
      getIsReplaying: () => false,
      sessionRuntime: this.sessionRuntime,
      sessionRepo: this.sessionRepo,
    });

    const conn = this.agentRuntime.createAcpConnection(
      proc,
      handlers as acp.Client
    );
    chatSession.conn = conn;

    const agentCapabilities = await this.initializeConnection(
      chatSession,
      chatId
    );

    if (params.sessionIdToLoad && !chatSession.loadSessionSupported) {
      console.log(
        `[DEBUG] Resume rejected for ${chatId}:`,
        `sessionIdToLoad=${params.sessionIdToLoad},`,
        `loadSessionSupported=${chatSession.loadSessionSupported}`
      );
      this.sessionRuntime.delete(chatId);
      proc.kill();
      throw new Error("Agent does not support session/load");
    }

    const mcpServers = this.resolveMcpServers(agentCapabilities);

    if (params.sessionIdToLoad) {
      await this.handleSessionLoad(
        chatSession,
        chatId,
        params,
        projectRoot,
        buffer,
        mcpServers
      );
    } else {
      await this.handleNewSession(chatSession, chatId, projectRoot, mcpServers);
    }

    this.attachProcessHandlers(proc, chatId);
    this.saveSessionMetadata(
      chatId,
      params,
      chatSession,
      agentCmd,
      agentArgs,
      agentEnv,
      projectRoot
    );

    return chatSession;
  }

  /**
   * Resolves the project root, validating against allowed roots
   *
   * @param projectRoot - The requested project root
   * @returns The validated project root
   */
  private resolveProjectRoot(projectRoot: string): string {
    const { projectRoots } = this.settingsRepo.get();
    if (!projectRoots || projectRoots.length === 0) {
      return projectRoot;
    }
    return projectRoot;
  }

  /**
   * Resolves MCP servers, filtering out unsupported transports
   *
   * @param agentCapabilities - Agent's reported capabilities
   * @returns Array of MCP servers compatible with the agent
   * @throws Error if agent doesn't support required MCP transports
   */
  private resolveMcpServers(agentCapabilities?: {
    mcpCapabilities?: { http?: boolean; sse?: boolean };
    mcp?: { http?: boolean; sse?: boolean };
  }): McpServerConfig[] {
    const { mcpServers } = this.settingsRepo.get();
    if (!mcpServers || mcpServers.length === 0) {
      return [];
    }

    const mcpCaps =
      agentCapabilities?.mcpCapabilities ?? agentCapabilities?.mcp;
    const httpSupported = Boolean(mcpCaps?.http);
    const sseSupported = Boolean(mcpCaps?.sse);
    const blocked = mcpServers.filter((server) => {
      if (this.isHttpServer(server)) {
        return !httpSupported;
      }
      if (this.isSseServer(server)) {
        return !sseSupported;
      }
      return false;
    });

    if (blocked.length > 0) {
      const blockedNames = blocked.map((server) => server.name).join(", ");
      throw new Error(
        `Agent does not support MCP transports for: ${blockedNames}`
      );
    }

    return mcpServers;
  }

  /**
   * Attaches process event handlers for error and exit events
   *
   * @param proc - The spawned agent process
   * @param chatId - The chat session identifier
   */
  private attachProcessHandlers(
    proc: ReturnType<typeof this.agentRuntime.spawn>,
    chatId: string
  ) {
    proc.on("error", (err: Error) => {
      console.error(`[Server] Agent process error for ${chatId}:`, err);
      this.sessionRuntime.broadcast(chatId, {
        type: "error",
        error: `Agent process error: ${err.message}`,
      });
      this.sessionRepo.updateStatus(chatId, "stopped");
      const session = this.sessionRuntime.get(chatId);
      if (session) {
        terminateSessionTerminals(session);
      }
    });

    proc.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      console.log(
        `[Server] Agent process for ${chatId} exited with code ${code}${signal ? ` signal ${signal}` : ""}`
      );
      const isExpectedSignal = signal === "SIGTERM" || signal === "SIGINT";
      const isCleanExit = code === 0 || (code === null && isExpectedSignal);

      if (!isCleanExit) {
        const reason = signal
          ? `signal ${signal}`
          : `code ${code ?? "unknown"}`;
        this.sessionRuntime.broadcast(chatId, {
          type: "error",
          error: `Agent process exited with ${reason}`,
        });
      }

      this.sessionRepo.updateStatus(chatId, "stopped");
      const session = this.sessionRuntime.get(chatId);
      if (session) {
        terminateSessionTerminals(session);
      }
      if (this.sessionRuntime.has(chatId)) {
        this.sessionRuntime.delete(chatId);
      }
    });
  }

  /**
   * Replays stored messages from the repository
   *
   * @param chatId - The chat session identifier
   */
  private replayStoredMessages(chatId: string) {
    const storedMessages = this.sessionRepo.getMessages(chatId);
    if (storedMessages.length === 0) {
      console.warn(
        `[Server] Agent did not replay history for ${chatId}, and no stored messages were found.`
      );
      return;
    }
    console.warn(
      `[Server] Agent did not replay history for ${chatId}; replaying ${storedMessages.length} stored messages.`
    );
    for (const message of storedMessages) {
      this.broadcastStoredMessage(chatId, message);
    }
  }

  /**
   * Broadcasts a stored message to the session
   *
   * @param chatId - The chat session identifier
   * @param message - The stored message to broadcast
   */
  private broadcastStoredMessage(chatId: string, message: StoredMessage) {
    const contentBlocks =
      message.contentBlocks ??
      (message.content ? [{ type: "text", text: message.content }] : []);
    const reasoningBlocks =
      message.reasoningBlocks ??
      (message.reasoning ? [{ type: "text", text: message.reasoning }] : []);

    if (message.role === "user") {
      if (contentBlocks.length === 0) {
        return;
      }
      for (const block of contentBlocks) {
        this.sessionRuntime.broadcast(chatId, {
          type: "session_update",
          update: {
            sessionUpdate: "user_message_chunk",
            content: block,
          },
        });
      }
      return;
    }

    for (const block of reasoningBlocks) {
      this.sessionRuntime.broadcast(chatId, {
        type: "session_update",
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: block,
        },
      });
    }

    for (const block of contentBlocks) {
      this.sessionRuntime.broadcast(chatId, {
        type: "session_update",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: block,
        },
      });
    }
  }
}
