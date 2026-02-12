import type * as acp from "@agentclientprotocol/sdk";
import { CLIENT_INFO } from "@/config/constants";
import { AppError, ValidationError } from "@/shared/errors";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type {
  ChatSession,
  SessionModelState,
  SessionModeState,
} from "@/shared/types/session.types";
import { terminateProcessGracefully } from "@/shared/utils/process-termination.util";
import type { AgentRuntimePort } from "./ports/agent-runtime.port";
import type {
  SessionAcpPort,
  SessionBufferingPort,
} from "./ports/session-acp.port";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import type { SessionHistoryReplayService } from "./session-history-replay.service";
import type { SessionMcpConfigService } from "./session-mcp-config.service";

const OP = "session.lifecycle.create";

interface SessionConnectionResult {
  modes?: SessionModeState | null;
  models?: SessionModelState | null;
}

interface SessionModelConnection {
  unstable_setSessionModel: (params: {
    sessionId: string;
    modelId: string;
  }) => Promise<void>;
}

interface ResumeConnection {
  unstable_resumeSession: (params: {
    sessionId: string;
    cwd: string;
    mcpServers: acp.McpServer[];
  }) => Promise<SessionConnectionResult>;
}

interface InitializeCapabilities {
  mcpCapabilities?: { http?: boolean; sse?: boolean };
  mcp?: { http?: boolean; sse?: boolean };
  loadSession?: unknown;
  sessionCapabilities?: {
    resume?: unknown;
    setModel?: unknown;
  };
}

export interface BootstrapSessionInput {
  chatId: string;
  chatSession: ChatSession;
  buffer: SessionBufferingPort;
  projectRoot: string;
  sessionIdToLoad?: string;
}

export class SessionAcpBootstrapService {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionAcp: SessionAcpPort;
  private readonly agentRuntime: AgentRuntimePort;
  private readonly mcpConfig: SessionMcpConfigService;
  private readonly historyReplay: SessionHistoryReplayService;
  private readonly logger: LoggerPort;
  private readonly runtimeConfigProvider: () => { defaultModel: string };

  constructor(
    sessionRuntime: SessionRuntimePort,
    sessionRepo: SessionRepositoryPort,
    sessionAcp: SessionAcpPort,
    agentRuntime: AgentRuntimePort,
    mcpConfig: SessionMcpConfigService,
    historyReplay: SessionHistoryReplayService,
    logger: LoggerPort,
    runtimeConfigProvider: () => { defaultModel: string }
  ) {
    this.sessionRuntime = sessionRuntime;
    this.sessionRepo = sessionRepo;
    this.sessionAcp = sessionAcp;
    this.agentRuntime = agentRuntime;
    this.mcpConfig = mcpConfig;
    this.historyReplay = historyReplay;
    this.logger = logger;
    this.runtimeConfigProvider = runtimeConfigProvider;
  }

  async bootstrap(input: BootstrapSessionInput): Promise<void> {
    const { chatId, chatSession, buffer, projectRoot, sessionIdToLoad } = input;

    try {
      this.attachConnection({ chatId, chatSession, buffer });

      const capabilities = await this.initializeConnection(chatSession, chatId);
      if (sessionIdToLoad && !chatSession.loadSessionSupported) {
        this.logger.warn("Resume rejected due to missing load capability", {
          chatId,
          sessionIdToLoad,
          loadSessionSupported: chatSession.loadSessionSupported,
        });
        throw new ValidationError("Agent does not support session/load", {
          module: "session",
          op: OP,
          details: { chatId },
        });
      }

      const mcpServers = await this.mcpConfig.resolveServers(capabilities);
      const acpMcpServers = this.mcpConfig.toAcpServers(mcpServers);

      if (sessionIdToLoad) {
        await this.loadExistingSession({
          chatId,
          chatSession,
          buffer,
          projectRoot,
          sessionIdToLoad,
          acpMcpServers,
        });
        return;
      }

      await this.createNewSession({
        chatId,
        chatSession,
        projectRoot,
        acpMcpServers,
      });
    } catch (error) {
      await this.cleanupFailedBootstrap(chatId, chatSession);
      throw error;
    }
  }

  private attachConnection(params: {
    chatId: string;
    chatSession: ChatSession;
    buffer: SessionBufferingPort;
  }): void {
    const { chatId, chatSession, buffer } = params;
    const handlers = this.sessionAcp.createHandlers({
      chatId,
      buffer,
      getIsReplaying: () => Boolean(chatSession.isReplayingHistory),
      sessionRuntime: this.sessionRuntime,
      sessionRepo: this.sessionRepo,
    });

    chatSession.conn = this.agentRuntime.createAcpConnection(
      chatSession.proc,
      handlers as acp.Client
    );
  }

  private async initializeConnection(
    chatSession: ChatSession,
    chatId: string
  ): Promise<InitializeCapabilities | undefined> {
    const initResult = await chatSession.conn.initialize({
      protocolVersion: 1,
      clientInfo: CLIENT_INFO,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });

    this.logger.debug("ACP initialize response", {
      chatId,
      protocolVersion: initResult?.protocolVersion,
      hasAgentCapabilities: Boolean(initResult?.agentCapabilities),
      loadSessionType: typeof initResult?.agentCapabilities?.loadSession,
    });

    if (initResult.protocolVersion !== 1) {
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

    const agentCapabilities = initResult?.agentCapabilities as
      | InitializeCapabilities
      | undefined;
    chatSession.promptCapabilities =
      initResult?.agentCapabilities?.promptCapabilities ?? {};

    const hasLoadSession = Boolean(agentCapabilities?.loadSession);
    const hasResumeCapability = Boolean(
      agentCapabilities?.sessionCapabilities?.resume
    );

    chatSession.loadSessionSupported = hasLoadSession || hasResumeCapability;
    chatSession.useUnstableResume = hasResumeCapability;
    chatSession.supportsModelSwitching = Boolean(
      agentCapabilities?.sessionCapabilities?.setModel
    );

    this.logger.debug("Agent session capabilities resolved", {
      chatId,
      hasLoadSession,
      hasResumeCapability,
      loadSessionSupported: chatSession.loadSessionSupported,
      useUnstableResume: chatSession.useUnstableResume,
      supportsModelSwitching: chatSession.supportsModelSwitching,
    });

    chatSession.agentInfo = initResult?.agentInfo
      ? {
          name: initResult.agentInfo.name,
          title: initResult.agentInfo.title ?? undefined,
          version: initResult.agentInfo.version,
        }
      : undefined;

    chatSession.agentCapabilities =
      (initResult?.agentCapabilities as Record<string, unknown> | undefined) ??
      undefined;
    chatSession.authMethods = initResult?.authMethods as
      | Array<{ name: string; id: string; description: string }>
      | undefined;

    this.logger.debug("Agent info resolved", {
      chatId,
      hasAgentInfo: Boolean(chatSession.agentInfo),
    });

    return agentCapabilities;
  }

  private async loadExistingSession(params: {
    chatId: string;
    chatSession: ChatSession;
    buffer: SessionBufferingPort;
    projectRoot: string;
    sessionIdToLoad: string;
    acpMcpServers: acp.McpServer[];
  }): Promise<void> {
    const {
      chatId,
      chatSession,
      buffer,
      projectRoot,
      sessionIdToLoad,
      acpMcpServers,
    } = params;

    let loadResult: SessionConnectionResult;

    if (chatSession.useUnstableResume) {
      chatSession.isReplayingHistory = false;
      this.logger.debug("Using unstable resume session", {
        chatId,
        sessionIdToLoad,
      });
      const conn = chatSession.conn as unknown as ResumeConnection;

      try {
        loadResult = await conn.unstable_resumeSession({
          sessionId: sessionIdToLoad,
          cwd: projectRoot,
          mcpServers: acpMcpServers,
        });
      } catch (error) {
        const canFallbackToLoad = Boolean(
          chatSession.agentCapabilities?.loadSession
        );
        if (!canFallbackToLoad) {
          throw error;
        }
        this.logger.warn("unstable_resumeSession failed, using loadSession", {
          chatId,
          sessionIdToLoad,
          error: error instanceof Error ? error.message : String(error),
        });
        chatSession.isReplayingHistory = true;
        this.logger.debug("Using loadSession fallback after unstable resume", {
          chatId,
          sessionIdToLoad,
        });
        loadResult = await chatSession.conn.loadSession({
          sessionId: sessionIdToLoad,
          cwd: projectRoot,
          mcpServers: acpMcpServers,
        });
      }
    } else {
      chatSession.isReplayingHistory = true;
      this.logger.debug("Using loadSession", { chatId, sessionIdToLoad });
      loadResult = await chatSession.conn.loadSession({
        sessionId: sessionIdToLoad,
        cwd: projectRoot,
        mcpServers: acpMcpServers,
      });
    }

    chatSession.isReplayingHistory = false;
    chatSession.modes = loadResult.modes ?? undefined;
    chatSession.models = loadResult.models ?? undefined;

    const currentModeId = chatSession.modes?.currentModeId;
    if (currentModeId) {
      await this.sessionRuntime.broadcast(chatId, {
        type: "current_mode_update",
        modeId: currentModeId,
      });
    }

    await this.historyReplay.broadcastPromptEnd(chatId, buffer);
  }

  private async createNewSession(params: {
    chatId: string;
    chatSession: ChatSession;
    projectRoot: string;
    acpMcpServers: acp.McpServer[];
  }): Promise<void> {
    const { chatId, chatSession, projectRoot, acpMcpServers } = params;
    const newResult = await chatSession.conn.newSession({
      cwd: projectRoot,
      mcpServers: acpMcpServers,
    });

    chatSession.sessionId = newResult.sessionId;
    chatSession.modes = newResult.modes ?? undefined;
    chatSession.models = newResult.models ?? undefined;
    await this.applyDefaultModel(chatId, chatSession);

    if (chatSession.modes?.currentModeId) {
      await this.sessionRuntime.broadcast(chatId, {
        type: "current_mode_update",
        modeId: chatSession.modes.currentModeId,
      });
    }

    this.sessionRuntime.set(chatId, chatSession);
  }

  private async applyDefaultModel(
    chatId: string,
    chatSession: ChatSession
  ): Promise<void> {
    const configuredDefaultModel =
      this.runtimeConfigProvider().defaultModel.trim();
    if (!configuredDefaultModel) {
      return;
    }
    if (!chatSession.supportsModelSwitching) {
      this.logger.warn(
        "Default model is configured but agent does not support model switching",
        {
          chatId,
          defaultModel: configuredDefaultModel,
        }
      );
      return;
    }
    const models = chatSession.models?.availableModels ?? [];
    if (models.length === 0) {
      this.logger.warn(
        "Default model is configured but session did not expose available models",
        {
          chatId,
          defaultModel: configuredDefaultModel,
        }
      );
      return;
    }
    const matchedModel = models.find(
      (model) =>
        model.modelId === configuredDefaultModel ||
        model.name === configuredDefaultModel
    );
    if (!matchedModel) {
      this.logger.warn("Configured default model not found in session models", {
        chatId,
        defaultModel: configuredDefaultModel,
      });
      return;
    }
    if (chatSession.models?.currentModelId === matchedModel.modelId) {
      return;
    }
    if (!chatSession.sessionId) {
      return;
    }

    try {
      await (
        chatSession.conn as unknown as SessionModelConnection
      ).unstable_setSessionModel({
        sessionId: chatSession.sessionId,
        modelId: matchedModel.modelId,
      });
      if (chatSession.models) {
        chatSession.models.currentModelId = matchedModel.modelId;
      }
      this.logger.info("Applied runtime default model to new session", {
        chatId,
        modelId: matchedModel.modelId,
      });
    } catch (error) {
      this.logger.warn("Failed to apply runtime default model", {
        chatId,
        defaultModel: configuredDefaultModel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async cleanupFailedBootstrap(
    chatId: string,
    chatSession: ChatSession
  ): Promise<void> {
    if (this.sessionRuntime.has(chatId)) {
      this.sessionRuntime.delete(chatId);
    }
    await terminateProcessGracefully(chatSession.proc);
  }
}
