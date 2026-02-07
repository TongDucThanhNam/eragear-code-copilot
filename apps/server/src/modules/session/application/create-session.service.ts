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
import type { ProjectRepositoryPort } from "@/modules/project";
import type { SettingsRepositoryPort } from "@/modules/settings";
import { AppError, NotFoundError, ValidationError } from "@/shared/errors";
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
import { updateChatStatus } from "../../../shared/utils/chat-events.util";
import { terminateSessionTerminals } from "../../../shared/utils/session-cleanup.util";
import {
  buildAssistantMessageFromBlocks,
  buildPlanToolPart,
  buildUserMessageFromBlocks,
  createUiMessageState,
  finalizeStreamingParts,
  getOrCreateAssistantMessage,
  getPlanToolCallId,
  upsertToolPart,
} from "../../../shared/utils/ui-message.util";
import type { AgentRuntimePort } from "./ports/agent-runtime.port";
import type {
  SessionAcpPort,
  SessionBufferingPort,
} from "./ports/session-acp.port";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

const STORED_REPLAY_PAGE_LIMIT = 200;
const OP = "session.lifecycle.create";

/**
 * Parameters for creating a new session
 */
export interface CreateSessionParams {
  /** Optional project ID this session belongs to */
  projectId?: string;
  /** Optional file system path to the project root directory */
  projectRoot?: string;
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
  /** Repository for project metadata */
  private readonly projectRepo: ProjectRepositoryPort;
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
    projectRepo: ProjectRepositoryPort,
    sessionAcp: SessionAcpPort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.agentRuntime = agentRuntime;
    this.settingsRepo = settingsRepo;
    this.projectRepo = projectRepo;
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
      throw new AppError({
        code: "AGENT_PROTOCOL_MISMATCH",
        statusCode: 500,
        module: "session",
        op: OP,
        message: `Agent protocol version mismatch: ${initResult.protocolVersion}`,
        details: {
          protocolVersion: initResult.protocolVersion,
          chatId,
        },
      });
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
    // Prefer resume when supported (fallback to loadSession if needed)
    chatSession.useUnstableResume = hasResumeCapability;

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
        chatSession.isReplayingHistory = false;
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
        try {
          loadResult = await conn.unstable_resumeSession({
            sessionId: params.sessionIdToLoad ?? "",
            cwd: projectRoot,
            mcpServers: this.convertMcpServersToAcpFormat(mcpServers),
          });
        } catch (error) {
          const canFallbackToLoad = Boolean(
            chatSession.agentCapabilities?.loadSession
          );
          if (!canFallbackToLoad) {
            throw error;
          }
          console.warn(
            "[DEBUG] unstable_resumeSession failed; falling back to loadSession",
            error
          );
          chatSession.isReplayingHistory = true;
          console.log(
            "[DEBUG] Using loadSession for session:",
            params.sessionIdToLoad
          );
          loadResult = await chatSession.conn.loadSession({
            sessionId: params.sessionIdToLoad ?? "",
            cwd: projectRoot,
            mcpServers: this.convertMcpServersToAcpFormat(mcpServers),
          });
          chatSession.isReplayingHistory = false;
        }
      } else {
        chatSession.isReplayingHistory = true;
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
        chatSession.isReplayingHistory = false;
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

      await this.broadcastPromptEnd(chatId, buffer);
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
  private async broadcastPromptEnd(
    chatId: string,
    buffer: SessionBufferingPort
  ) {
    const session = this.sessionRuntime.get(chatId);
    const shouldReplayStored =
      buffer.replayEventCount === 0 && !session?.suppressReplayBroadcast;
    if (shouldReplayStored) {
      await this.replayStoredMessages(chatId);
    }
    const currentMessageId = session?.uiState.currentAssistantId;
    if (session && currentMessageId) {
      const message = session.uiState.messages.get(currentMessageId);
      if (message) {
        finalizeStreamingParts(message);
        this.sessionRuntime.broadcast(chatId, {
          type: "ui_message",
          message,
        });
      }
      session.uiState.currentAssistantId = undefined;
    }
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
  private async saveSessionMetadata(
    chatId: string,
    params: CreateSessionParams,
    chatSession: ChatSession,
    agentCmd: string,
    agentArgs: string[],
    agentEnv: Record<string, string>,
    projectRoot: string
  ) {
    const commonSessionData = {
      projectId: params.projectId ?? chatSession.projectId,
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
      await this.sessionRepo.updateMetadata(chatId, {
        sessionId: chatSession.sessionId,
        ...commonSessionData,
      });
    } else {
      await this.sessionRepo.save({
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
    const agentArgs = params.args ?? this.resolveDefaultAgentArgs(agentCmd);
    const agentEnv = params.env ?? {};
    const projectContext = await this.resolveProjectContext(params);
    const projectRoot = projectContext.projectRoot;

    console.log(
      `[DEBUG] Using agent: command="${agentCmd}", args=${JSON.stringify(agentArgs)}`
    );

    // Spawn process
    const proc = this.agentRuntime.spawn(agentCmd, agentArgs, {
      cwd: projectRoot,
      env: agentEnv,
    });

    const buffer = this.sessionAcp.createBuffer();
    const storedSession = params.chatId
      ? await this.sessionRepo.findById(chatId)
      : undefined;
    const storedPlan = storedSession?.plan;
    const hasStoredMessages =
      Boolean(params.sessionIdToLoad) &&
      (
        await this.sessionRepo.getMessagesPage(chatId, {
          limit: 1,
          includeCompacted: true,
        })
      ).messages.length > 0;

    // Create runtime session
    const chatSession: ChatSession = {
      id: chatId,
      proc,
      conn: null as unknown as ChatSession["conn"],
      projectId: projectContext.projectId,
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
      uiState: createUiMessageState(),
      isReplayingHistory: false,
      suppressReplayBroadcast: hasStoredMessages,
      lastAssistantChunkType: undefined,
      chatStatus: "connecting",
    };

    // Store in runtime before ACP hooks
    this.sessionRuntime.set(chatId, chatSession);

    if (chatSession.plan) {
      const message = getOrCreateAssistantMessage(chatSession.uiState);
      const planTool = buildPlanToolPart(
        chatSession.plan,
        getPlanToolCallId(chatId)
      );
      const { message: updated } = upsertToolPart({
        state: chatSession.uiState,
        messageId: message.id,
        part: planTool,
      });
      this.sessionRuntime.broadcast(chatId, {
        type: "ui_message",
        message: updated,
      });
    }

    const handlers = this.sessionAcp.createHandlers({
      chatId,
      buffer,
      getIsReplaying: () => Boolean(chatSession.isReplayingHistory),
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
      throw new ValidationError("Agent does not support session/load", {
        module: "session",
        op: OP,
        details: { chatId },
      });
    }

    const mcpServers = await this.resolveMcpServers(agentCapabilities);

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

    updateChatStatus({
      chatId,
      session: chatSession,
      broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
      status: "ready",
    });

    this.attachProcessHandlers(proc, chatId);
    await this.saveSessionMetadata(
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

  private resolveDefaultAgentArgs(agentCmd: string): string[] {
    if (agentCmd === "opencode") {
      return ["acp"];
    }
    return [];
  }

  private async resolveProjectContext(params: CreateSessionParams): Promise<{
    projectId?: string;
    projectRoot: string;
  }> {
    if (params.projectId) {
      const project = await this.projectRepo.findById(params.projectId);
      if (!project) {
        throw new NotFoundError("Project not found", {
          module: "session",
          op: OP,
          details: { projectId: params.projectId },
        });
      }
      return {
        projectId: project.id,
        projectRoot: project.path,
      };
    }

    if (!params.projectRoot) {
      throw new ValidationError(
        "projectRoot is required when projectId is not provided",
        {
          module: "session",
          op: OP,
        }
      );
    }

    const projectRoot = params.projectRoot;
    const { projectRoots } = await this.settingsRepo.get();
    if (!projectRoots || projectRoots.length === 0) {
      return { projectRoot };
    }
    return { projectRoot };
  }

  /**
   * Resolves MCP servers, filtering out unsupported transports
   *
   * @param agentCapabilities - Agent's reported capabilities
   * @returns Array of MCP servers compatible with the agent
   * @throws Error if agent doesn't support required MCP transports
   */
  private async resolveMcpServers(agentCapabilities?: {
    mcpCapabilities?: { http?: boolean; sse?: boolean };
    mcp?: { http?: boolean; sse?: boolean };
  }): Promise<McpServerConfig[]> {
    const { mcpServers } = await this.settingsRepo.get();
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
      throw new ValidationError(
        `Agent does not support MCP transports for: ${blockedNames}`,
        {
          module: "session",
          op: OP,
          details: { blockedNames },
        }
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
    proc.on("error", async (err: Error) => {
      console.error(`[Server] Agent process error for ${chatId}:`, err);
      this.sessionRuntime.broadcast(chatId, {
        type: "error",
        error: `Agent process error: ${err.message}`,
      });
      const session = this.sessionRuntime.get(chatId);
      updateChatStatus({
        chatId,
        session,
        broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
        status: "error",
      });
      await this.sessionRepo.updateStatus(chatId, "stopped");
      if (session) {
        terminateSessionTerminals(session);
      }
    });

    proc.on(
      "exit",
      async (code: number | null, signal: NodeJS.Signals | null) => {
        console.log(
          `[Server] Agent process for ${chatId} exited with code ${code}${signal ? ` signal ${signal}` : ""}`
        );
        const isExpectedSignal = signal === "SIGTERM" || signal === "SIGINT";
        const isCleanExit = code === 0 || (code === null && isExpectedSignal);

        if (isCleanExit) {
          const session = this.sessionRuntime.get(chatId);
          updateChatStatus({
            chatId,
            session,
            broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
            status: "inactive",
          });
        } else {
          const reason = signal
            ? `signal ${signal}`
            : `code ${code ?? "unknown"}`;
          this.sessionRuntime.broadcast(chatId, {
            type: "error",
            error: `Agent process exited with ${reason}`,
          });
          const session = this.sessionRuntime.get(chatId);
          updateChatStatus({
            chatId,
            session,
            broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
            status: "error",
          });
        }

        await this.sessionRepo.updateStatus(chatId, "stopped");
        const session = this.sessionRuntime.get(chatId);
        if (session) {
          terminateSessionTerminals(session);
        }
        if (this.sessionRuntime.has(chatId)) {
          this.sessionRuntime.delete(chatId);
        }
      }
    );
  }

  /**
   * Replays stored messages from the repository
   *
   * @param chatId - The chat session identifier
   */
  private async replayStoredMessages(chatId: string) {
    const storedMessages: StoredMessage[] = [];
    let cursor: number | undefined;
    while (true) {
      const page = await this.sessionRepo.getMessagesPage(chatId, {
        cursor,
        limit: STORED_REPLAY_PAGE_LIMIT,
        includeCompacted: true,
      });
      storedMessages.push(...page.messages);
      if (!page.hasMore || page.nextCursor === undefined) {
        break;
      }
      cursor = page.nextCursor;
    }
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
    const compactedText =
      message.role === "assistant"
        ? "[Assistant message compacted for local retention]"
        : "[User message compacted for local retention]";

    if (message.parts && message.parts.length > 0) {
      const uiMessage = {
        id: message.id,
        role: message.role,
        parts: message.parts,
      };
      const session = this.sessionRuntime.get(chatId);
      if (session) {
        session.uiState.messages.set(uiMessage.id, uiMessage);
      }
      this.sessionRuntime.broadcast(chatId, {
        type: "ui_message",
        message: uiMessage,
      });
      return;
    }

    let contentBlocks = message.contentBlocks;
    if (!contentBlocks) {
      if (message.content) {
        contentBlocks = [{ type: "text", text: message.content }];
      } else if (message.isCompacted) {
        contentBlocks = [{ type: "text", text: compactedText }];
      } else {
        contentBlocks = [];
      }
    }
    const reasoningBlocks =
      message.reasoningBlocks ??
      (message.reasoning ? [{ type: "text", text: message.reasoning }] : []);
    const session = this.sessionRuntime.get(chatId);

    if (message.role === "user") {
      if (contentBlocks.length === 0) {
        return;
      }
      const uiMessage = buildUserMessageFromBlocks({
        messageId: message.id,
        contentBlocks,
      });
      if (session) {
        session.uiState.messages.set(uiMessage.id, uiMessage);
      }
      this.sessionRuntime.broadcast(chatId, {
        type: "ui_message",
        message: uiMessage,
      });
      return;
    }
    const uiMessage = buildAssistantMessageFromBlocks({
      messageId: message.id,
      contentBlocks,
      reasoningBlocks,
    });
    if (session) {
      session.uiState.messages.set(uiMessage.id, uiMessage);
    }
    this.sessionRuntime.broadcast(chatId, {
      type: "ui_message",
      message: uiMessage,
    });
  }
}
