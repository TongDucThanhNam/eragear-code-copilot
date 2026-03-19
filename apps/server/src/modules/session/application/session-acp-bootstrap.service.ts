import type * as acp from "@agentclientprotocol/sdk";
import { CLIENT_INFO } from "@/config/constants";
import { ENV } from "@/config/environment";
import { AppError, ValidationError } from "@/shared/errors";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type {
  ChatSession,
  SessionConfigOption,
  SessionModelState,
  SessionModeState,
} from "@/shared/types/session.types";
import { terminateProcessGracefully } from "@/shared/utils/process-termination.util";
import { serializeRawPayloadForLog } from "@/platform/acp/raw-payload-log.util";
import {
  syncSessionSelectionFromConfigOptions,
  updateSessionConfigOptionCurrentValue,
} from "@/shared/utils/session-config-options.util";
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
const RAW_SETUP_PAYLOAD_LOG_LIMIT = 4000;

interface SessionConnectionResult {
  modes?: SessionModeState | null;
  models?: SessionModelState | null;
  configOptions?: SessionConfigOption[] | null;
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function supportsUnstableResume(conn: unknown): conn is ResumeConnection {
  if (!conn || typeof conn !== "object") {
    return false;
  }
  const candidate = conn as Partial<ResumeConnection>;
  return typeof candidate.unstable_resumeSession === "function";
}

function supportsSetSessionModel(
  conn: unknown
): conn is SessionModelConnection {
  if (!conn || typeof conn !== "object") {
    return false;
  }
  const candidate = conn as Partial<SessionModelConnection>;
  return typeof candidate.unstable_setSessionModel === "function";
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

  private logRawSetupPayload(
    chatId: string,
    step: "initialize" | "newSession" | "loadSession",
    payload: unknown
  ): void {
    let rawPayload = "";
    try {
      rawPayload = serializeRawPayloadForLog(payload).slice(
        0,
        RAW_SETUP_PAYLOAD_LOG_LIMIT
      );
    } catch {
      rawPayload = "[unserializable]";
    }
    this.logger.info("ACP raw session setup payload", {
      chatId,
      step,
      rawPayloadLength: rawPayload.length,
      rawPayload,
    });
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
      } else {
        await this.createNewSession({
          chatId,
          chatSession,
          projectRoot,
          acpMcpServers,
        });
      }

      this.finalizeBootstrapChatStatus(chatId, chatSession);
    } catch (error) {
      await this.cleanupFailedBootstrap(chatId, chatSession);
      throw error;
    }
  }

  private finalizeBootstrapChatStatus(
    chatId: string,
    chatSession: ChatSession
  ): void {
    if (chatSession.chatStatus !== "connecting") {
      return;
    }
    chatSession.chatStatus = "ready";
    this.logger.debug("Session bootstrap finalized chat status", {
      chatId,
      chatStatus: chatSession.chatStatus,
    });
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
        fs: {
          readTextFile: true,
          writeTextFile: ENV.acpFsWriteEnabled,
        },
        terminal: ENV.acpTerminalEnabled,
      },
    });
    this.logRawSetupPayload(chatId, "initialize", initResult);

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
    chatSession.useUnstableResume = hasResumeCapability && !hasLoadSession;
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

  private async broadcastSelectionSnapshots(
    chatId: string,
    chatSession: ChatSession
  ): Promise<void> {
    const currentModeId = chatSession.modes?.currentModeId;
    if (currentModeId) {
      await this.sessionRuntime.broadcast(chatId, {
        type: "current_mode_update",
        modeId: currentModeId,
        reason: "session_bootstrap_snapshot",
        metadata: {
          source: "session_bootstrap",
        },
      });
    }

    const currentModelId = chatSession.models?.currentModelId;
    if (currentModelId) {
      await this.sessionRuntime.broadcast(chatId, {
        type: "current_model_update",
        modelId: currentModelId,
      });
    }
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
    const canLoadSession = Boolean(chatSession.agentCapabilities?.loadSession);
    try {
      if (canLoadSession) {
        // loadSession is the canonical source of truth for history replay.
        // Never suppress its replay broadcast; otherwise newer agent-side messages
        // can be hidden behind stale local DB snapshots.
        chatSession.sessionLoadMethod = "session_load";
        chatSession.suppressReplayBroadcast = false;
        chatSession.isReplayingHistory = true;
        this.logger.debug("Using loadSession", { chatId, sessionIdToLoad });
        loadResult = await chatSession.conn.loadSession({
          sessionId: sessionIdToLoad,
          cwd: projectRoot,
          mcpServers: acpMcpServers,
        });
      } else {
        chatSession.sessionLoadMethod = "unstable_resume";
        chatSession.isReplayingHistory = false;
        this.logger.debug("Using unstable resume session", {
          chatId,
          sessionIdToLoad,
        });
        const resumeConn = chatSession.conn as unknown;
        if (!supportsUnstableResume(resumeConn)) {
          throw new ValidationError(
            "Agent does not support session/load or unstable resume",
            {
              module: "session",
              op: OP,
              details: { chatId, sessionIdToLoad },
            }
          );
        }
        loadResult = await resumeConn.unstable_resumeSession({
          sessionId: sessionIdToLoad,
          cwd: projectRoot,
          mcpServers: acpMcpServers,
        });
      }
      this.logRawSetupPayload(chatId, "loadSession", loadResult);
    } catch (error) {
      const method = canLoadSession ? "loadSession" : "unstable_resumeSession";
      throw new AppError({
        message: `Failed to resume agent session via ${method}: ${getErrorMessage(error)}`,
        code: "AGENT_SESSION_LOAD_FAILED",
        statusCode: 502,
        module: "session",
        op: OP,
        details: { chatId, sessionIdToLoad, method },
        cause: error,
      });
    }

    chatSession.isReplayingHistory = false;
    chatSession.modes = loadResult.modes ?? undefined;
    chatSession.models = loadResult.models ?? undefined;
    chatSession.configOptions = loadResult.configOptions ?? undefined;
    syncSessionSelectionFromConfigOptions(chatSession);
    await this.broadcastSelectionSnapshots(chatId, chatSession);

    await this.historyReplay.broadcastPromptEnd(chatId, buffer);
  }

  private async createNewSession(params: {
    chatId: string;
    chatSession: ChatSession;
    projectRoot: string;
    acpMcpServers: acp.McpServer[];
  }): Promise<void> {
    const { chatId, chatSession, projectRoot, acpMcpServers } = params;
    chatSession.sessionLoadMethod = "new_session";
    const newResult = await chatSession.conn.newSession({
      cwd: projectRoot,
      mcpServers: acpMcpServers,
    });
    this.logRawSetupPayload(chatId, "newSession", newResult);

    chatSession.sessionId = newResult.sessionId;
    chatSession.modes = newResult.modes ?? undefined;
    chatSession.models = newResult.models ?? undefined;
    chatSession.configOptions = newResult.configOptions ?? undefined;
    syncSessionSelectionFromConfigOptions(chatSession);
    await this.applyDefaultModel(chatId, chatSession);
    await this.broadcastSelectionSnapshots(chatId, chatSession);

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
      const modelOptionUpdated = updateSessionConfigOptionCurrentValue({
        configOptions: chatSession.configOptions,
        target: "model",
        value: matchedModel.modelId,
      });
      if (modelOptionUpdated) {
        syncSessionSelectionFromConfigOptions(chatSession);
      }
      return;
    }
    if (!chatSession.sessionId) {
      return;
    }
    if (!supportsSetSessionModel(chatSession.conn)) {
      this.logger.warn(
        "Agent reported model switching support but unstable_setSessionModel is unavailable",
        {
          chatId,
          defaultModel: configuredDefaultModel,
        }
      );
      return;
    }

    try {
      await chatSession.conn.unstable_setSessionModel({
        sessionId: chatSession.sessionId,
        modelId: matchedModel.modelId,
      });
      if (chatSession.models) {
        chatSession.models.currentModelId = matchedModel.modelId;
      }
      const modelOptionUpdated = updateSessionConfigOptionCurrentValue({
        configOptions: chatSession.configOptions,
        target: "model",
        value: matchedModel.modelId,
      });
      if (modelOptionUpdated) {
        syncSessionSelectionFromConfigOptions(chatSession);
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
    this.sessionRuntime.deleteIfMatch(chatId, chatSession);
    await terminateProcessGracefully(chatSession.proc, {
      forceWindowsTreeTermination: true,
    });
  }
}
