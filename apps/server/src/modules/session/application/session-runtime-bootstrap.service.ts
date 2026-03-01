import { EventEmitter } from "node:events";
import type { ChatSession } from "@/shared/types/session.types";
import {
  buildPlanToolPart,
  createUiMessageState,
  getOrCreateAssistantMessage,
  getPlanToolCallId,
  upsertToolPart,
} from "@/shared/utils/ui-message.util";
import type {
  SessionAcpPort,
  SessionBufferingPort,
} from "./ports/session-acp.port";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

export interface CreateRuntimeSessionInput {
  chatId: string;
  userId: string;
  proc: ChatSession["proc"];
  projectId?: string;
  projectRoot: string;
  sessionIdToLoad?: string;
  importExternalHistoryOnLoad?: boolean;
  plan?: ChatSession["plan"];
}

export interface PreparedRuntimeSession {
  chatSession: ChatSession;
  buffer: SessionBufferingPort;
}

export class SessionRuntimeBootstrapService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionAcp: SessionAcpPort;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    sessionAcp: SessionAcpPort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.sessionAcp = sessionAcp;
  }

  async prepare(
    input: CreateRuntimeSessionInput
  ): Promise<PreparedRuntimeSession> {
    const suppressReplayBroadcast = await this.hasStoredMessages(
      input.chatId,
      input.userId,
      input.sessionIdToLoad
    );
    const buffer = this.sessionAcp.createBuffer();

    const chatSession: ChatSession = {
      id: input.chatId,
      userId: input.userId,
      proc: input.proc,
      conn: null as unknown as ChatSession["conn"],
      projectId: input.projectId,
      projectRoot: input.projectRoot,
      sessionId: input.sessionIdToLoad,
      plan: input.plan,
      emitter: new EventEmitter(),
      cwd: input.projectRoot,
      subscriberCount: 0,
      messageBuffer: [],
      pendingPermissions: new Map(),
      toolCalls: new Map(),
      terminals: new Map(),
      editorTextBuffers: new Map(),
      buffer,
      uiState: createUiMessageState(),
      isReplayingHistory: false,
      suppressReplayBroadcast,
      importExternalHistoryOnLoad: input.importExternalHistoryOnLoad,
      replayedStoredHistoryFallback: false,
      lastAssistantChunkType: undefined,
      chatStatus: "connecting",
    };

    this.sessionRuntime.set(input.chatId, chatSession);
    await this.broadcastStoredPlan(input.chatId, chatSession);
    return { chatSession, buffer };
  }

  private async hasStoredMessages(
    chatId: string,
    userId: string,
    sessionIdToLoad?: string
  ): Promise<boolean> {
    if (!sessionIdToLoad) {
      return false;
    }
    const page = await this.sessionRepo.getMessagesPage(chatId, userId, {
      limit: 1,
      includeCompacted: true,
    });
    return page.messages.length > 0;
  }

  private async broadcastStoredPlan(
    chatId: string,
    chatSession: ChatSession
  ): Promise<void> {
    if (!chatSession.plan) {
      return;
    }

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

    await this.sessionRuntime.broadcast(chatId, {
      type: "ui_message",
      message: updated,
    });
  }
}
