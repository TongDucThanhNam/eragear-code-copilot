// CreateSessionService - orchestrates session initialization
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { createSessionHandlers } from "@/infra/acp/handlers";
import { SessionBuffering } from "@/infra/acp/update";
import { CLIENT_INFO } from "../../../config/constants";
import type {
  AgentRuntimePort,
  SessionRepositoryPort,
  SessionRuntimePort,
  SettingsRepositoryPort,
} from "../../../shared/types/ports";
import type {
  ChatSession,
  StoredMessage,
} from "../../../shared/types/session.types";

export interface CreateSessionParams {
  projectId?: string;
  projectRoot: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  chatId?: string;
  sessionIdToLoad?: string;
}

export class CreateSessionService {
  constructor(
    private sessionRepo: SessionRepositoryPort,
    private sessionRuntime: SessionRuntimePort,
    private agentRuntime: AgentRuntimePort,
    private settingsRepo: SettingsRepositoryPort
  ) {}

  async execute(params: CreateSessionParams): Promise<ChatSession> {
    const chatId = params.chatId ?? crypto.randomUUID();
    const agentCmd = params.command ?? "opencode";
    const agentArgs = params.args ?? ["acp"];
    const agentEnv = params.env ?? {};
    const projectRoot = this.resolveProjectRoot(params.projectRoot);

    // Spawn process
    const proc = this.agentRuntime.spawn(agentCmd, agentArgs, {
      cwd: projectRoot,
      env: agentEnv,
    });

    const buffer = new SessionBuffering();
    let isReplayingHistory = false;

    // Create runtime session
    const chatSession: ChatSession = {
      id: chatId,
      proc,
      conn: null as any,
      projectId: params.projectId,
      projectRoot,
      sessionId: params.sessionIdToLoad,
      emitter: new EventEmitter(),
      cwd: projectRoot,
      subscriberCount: 0,
      messageBuffer: [],
      pendingPermissions: new Map(),
      terminals: new Map(),
      buffer,
    };

    // Store in runtime before ACP hooks
    this.sessionRuntime.set(chatId, chatSession);

    const handlers = createSessionHandlers({
      chatId,
      buffer,
      getIsReplaying: () => isReplayingHistory,
      sessionRuntime: this.sessionRuntime,
      sessionRepo: this.sessionRepo,
    });

    const conn = this.agentRuntime.createAcpConnection(proc, handlers);
    chatSession.conn = conn;

    const initResult = await conn.initialize({
      protocolVersion: 1,
      clientInfo: CLIENT_INFO,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });

    const agentCapabilities = initResult?.agentCapabilities;
    chatSession.promptCapabilities =
      agentCapabilities?.promptCapabilities ?? {};
    chatSession.loadSessionSupported = Boolean(agentCapabilities?.loadSession);
    chatSession.agentInfo = initResult?.agentInfo ?? undefined;

    if (params.sessionIdToLoad && !chatSession.loadSessionSupported) {
      proc.kill();
      throw new Error("Agent does not support session/load");
    }

    if (params.sessionIdToLoad) {
      try {
        isReplayingHistory = true;
        const loadResult = await conn.loadSession({
          sessionId: params.sessionIdToLoad,
          cwd: projectRoot,
          mcpServers: [],
        });
        isReplayingHistory = false;
        chatSession.modes = loadResult.modes ?? undefined;
        chatSession.models = loadResult.models ?? undefined;

        if (buffer.replayEventCount === 0) {
          this.replayStoredMessages(chatId);
          this.sessionRuntime.broadcast(chatId, {
            type: "session_update",
            update: { sessionUpdate: "prompt_end" },
          });
        } else {
          this.sessionRuntime.broadcast(chatId, {
            type: "session_update",
            update: { sessionUpdate: "prompt_end" },
          });
        }
      } catch (err) {
        isReplayingHistory = false;
        this.sessionRuntime.delete(chatId);
        proc.kill();
        throw err;
      }
    } else {
      const newResult = await conn.newSession({
        cwd: projectRoot,
        mcpServers: [],
      });
      chatSession.sessionId = newResult.sessionId;
      chatSession.modes = newResult.modes ?? undefined;
      chatSession.models = newResult.models ?? undefined;
      this.sessionRuntime.set(chatId, chatSession);
    }

    this.attachProcessHandlers(proc, chatId);

    const commonSessionData = {
      projectId: params.projectId,
      projectRoot,
      command: agentCmd,
      args: agentArgs,
      env: agentEnv,
      cwd: projectRoot,
      agentInfo: chatSession.agentInfo,
      loadSessionSupported: chatSession.loadSessionSupported,
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

    return chatSession;
  }

  private resolveProjectRoot(projectRoot: string): string {
    const { projectRoots } = this.settingsRepo.get();
    if (!projectRoots || projectRoots.length === 0) {
      return projectRoot;
    }
    return projectRoot;
  }

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
      if (this.sessionRuntime.has(chatId)) {
        this.sessionRuntime.delete(chatId);
      }
    });
  }

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

  private broadcastStoredMessage(chatId: string, message: StoredMessage) {
    if (message.role === "user") {
      if (!message.content) {
        return;
      }
      this.sessionRuntime.broadcast(chatId, {
        type: "session_update",
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: message.content },
        },
      });
      return;
    }

    if (message.reasoning) {
      this.sessionRuntime.broadcast(chatId, {
        type: "session_update",
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: message.reasoning },
        },
      });
    }

    if (message.content) {
      this.sessionRuntime.broadcast(chatId, {
        type: "session_update",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: message.content },
        },
      });
    }
  }
}
