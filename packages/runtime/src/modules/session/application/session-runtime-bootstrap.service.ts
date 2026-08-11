import { EventEmitter } from "node:events";
import type { ChatSession } from "#runtime/shared/types/session.types";
import {
  buildPlanToolPart,
  createUiMessageState,
  getOrCreateAssistantMessage,
  getPlanToolCallId,
  upsertToolPart,
} from "#runtime/shared/utils/ui-message.util";
import type {
  SessionAcpPort,
  SessionBufferingPort,
} from "./ports/session-acp.port";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

/**
 * Runtime session construction request after the agent process has been spawned.
 *
 * Ordering requirement: callers create the process first, then this service
 * registers runtime state before ACP handlers start streaming updates.
 */
export interface CreateRuntimeSessionInput {
  chatId: string;
  userId: string;
  proc: ChatSession["proc"];
  projectId?: string;
  projectRoot: string;
  envMode?: "local" | "worktree";
  worktreePath?: string;
  worktreeBranch?: string;
  sessionIdToLoad?: string;
  importExternalHistoryOnLoad?: boolean;
  plan?: ChatSession["plan"];
  supervisor?: ChatSession["supervisor"];
}

/**
 * Runtime objects needed by the remaining bootstrap steps.
 *
 * Invariant: `chatSession` has been inserted into `SessionRuntimePort` and
 * `buffer` is the ACP buffering instance attached to that same session.
 */
export interface PreparedRuntimeSession {
  chatSession: ChatSession;
  buffer: SessionBufferingPort;
}

/**
 * Builds the in-memory chat session and registers it in the runtime store.
 *
 * Side effects: initializes UI state, suppresses duplicate replay broadcasts
 * when stored messages already exist, and emits a stored plan message when a
 * supervisor plan is restored.
 */
export class SessionRuntimeBootstrapService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionAcp: SessionAcpPort;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    sessionAcp: SessionAcpPort,
    uiMessageLimit: number
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.sessionAcp = sessionAcp;
    this.uiMessageLimit = Math.max(1, Math.trunc(uiMessageLimit));
  }

  private readonly uiMessageLimit: number;

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
      envMode: input.envMode,
      worktreePath: input.worktreePath,
      worktreeBranch: input.worktreeBranch,
      sessionId: input.sessionIdToLoad,
      plan: input.plan,
      supervisor: input.supervisor,
      emitter: new EventEmitter(),
      cwd: input.projectRoot,
      subscriberCount: 0,
      messageBuffer: [],
      pendingPermissions: new Map(),
      toolCalls: new Map(),
      terminals: new Map(),
      editorTextBuffers: new Map(),
      buffer,
      uiState: createUiMessageState({ messageLimit: this.uiMessageLimit }),
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
