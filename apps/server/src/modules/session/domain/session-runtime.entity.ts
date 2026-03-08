import type { UIMessage } from "@repo/shared";
import { AppError } from "@/shared/errors";
import type {
  BroadcastEvent,
  ChatSession,
  ChatStatus,
} from "@/shared/types/session.types";
import {
  isBusyChatStatus,
  maybeBroadcastChatFinish,
  setChatFinishStopReason,
  updateChatStatus,
} from "@/shared/utils/chat-events.util";

interface BroadcastContext {
  chatId: string;
  broadcast: (chatId: string, event: BroadcastEvent) => Promise<void>;
}

export const SESSION_RUNTIME_CHAT_STATUS = {
  AWAITING_PERMISSION: "awaiting_permission",
  CANCELLING: "cancelling",
  ERROR: "error",
  INACTIVE: "inactive",
  READY: "ready",
  STREAMING: "streaming",
  SUBMITTED: "submitted",
} as const satisfies Record<string, ChatStatus>;

export class SessionRuntimeEntity {
  private readonly session: ChatSession;

  constructor(session: ChatSession) {
    this.session = session;
  }

  get raw(): ChatSession {
    return this.session;
  }

  get assistantMessageId(): string | undefined {
    return (
      this.session.uiState.lastAssistantId ??
      this.session.uiState.currentAssistantId
    );
  }

  get activePromptTask() {
    return this.session.activePromptTask;
  }

  startTurn(turnId: string): void {
    this.session.activeTurnId = turnId;
    this.session.chatFinish = { turnId };
    // Turn boundary must reset assistant-stream pointers so the next
    // assistant response never appends into a previous turn's message.
    this.session.buffer?.reset();
    this.session.uiState.currentAssistantId = undefined;
    this.session.uiState.requiresTurnIdForNextAssistantChunk = undefined;
    this.session.lastAssistantChunkType = undefined;
    this.session.uiState.lastAssistantId = undefined;
  }

  setActivePromptTask(turnId: string, promise: Promise<void>): void {
    this.session.activePromptTask = { turnId, promise };
  }

  clearActivePromptTaskIf(turnId: string): void {
    if (this.session.activePromptTask?.turnId === turnId) {
      this.session.activePromptTask = undefined;
    }
  }

  isCurrentTurn(turnId: string): boolean {
    return this.session.activeTurnId === turnId;
  }

  clearActiveTurnIf(turnId: string): void {
    if (this.session.activeTurnId === turnId) {
      this.session.activeTurnId = undefined;
    }
  }

  clearTurnState(): void {
    this.session.activeTurnId = undefined;
    this.session.activePromptTask = undefined;
  }

  markSubmitted(context: BroadcastContext, turnId: string): Promise<void> {
    return this.updateStatus(
      context,
      SESSION_RUNTIME_CHAT_STATUS.SUBMITTED,
      turnId
    );
  }

  markCancelling(context: BroadcastContext): Promise<void> {
    return this.updateStatus(context, SESSION_RUNTIME_CHAT_STATUS.CANCELLING);
  }

  markAwaitingPermission(
    context: BroadcastContext,
    turnId?: string
  ): Promise<void> {
    return this.updateStatus(
      context,
      SESSION_RUNTIME_CHAT_STATUS.AWAITING_PERMISSION,
      turnId
    );
  }

  markInactive(context: BroadcastContext): Promise<void> {
    return this.updateStatus(context, SESSION_RUNTIME_CHAT_STATUS.INACTIVE);
  }

  markReady(context: BroadcastContext, turnId?: string): Promise<void> {
    return this.updateStatus(context, SESSION_RUNTIME_CHAT_STATUS.READY, turnId);
  }

  shouldStreamFromActivity(): boolean {
    if (this.session.chatStatus === SESSION_RUNTIME_CHAT_STATUS.CANCELLING) {
      return false;
    }
    return Boolean(this.session.activeTurnId || this.session.activePromptTask);
  }

  markStreamingFromActivity(
    context: BroadcastContext,
    turnId?: string
  ): Promise<void> {
    if (!this.shouldStreamFromActivity()) {
      return Promise.resolve();
    }
    return this.updateStatus(
      context,
      SESSION_RUNTIME_CHAT_STATUS.STREAMING,
      turnId
    );
  }

  resolveStatusAfterPermissionDecision(): ChatStatus {
    if (this.session.pendingPermissions.size > 0) {
      return SESSION_RUNTIME_CHAT_STATUS.AWAITING_PERMISSION;
    }
    if (
      this.session.chatStatus === SESSION_RUNTIME_CHAT_STATUS.AWAITING_PERMISSION
    ) {
      return this.shouldStreamFromActivity()
        ? SESSION_RUNTIME_CHAT_STATUS.STREAMING
        : SESSION_RUNTIME_CHAT_STATUS.READY;
    }
    return this.session.chatStatus;
  }

  syncStatusAfterPermissionDecision(
    context: BroadcastContext,
    turnId?: string
  ): Promise<void> {
    return this.updateStatus(
      context,
      this.resolveStatusAfterPermissionDecision(),
      turnId
    );
  }

  markError(context: BroadcastContext, turnId?: string): Promise<void> {
    return this.updateStatus(
      context,
      SESSION_RUNTIME_CHAT_STATUS.ERROR,
      turnId
    );
  }

  markReadyAfterTurnCompletion(
    context: BroadcastContext,
    turnId?: string
  ): Promise<void> {
    const currentStatus = this.session.chatStatus;
    if (
      currentStatus === SESSION_RUNTIME_CHAT_STATUS.ERROR ||
      currentStatus === "inactive"
    ) {
      return Promise.resolve();
    }
    if (!isBusyChatStatus(currentStatus)) {
      return Promise.resolve();
    }
    return this.updateStatus(
      context,
      SESSION_RUNTIME_CHAT_STATUS.READY,
      turnId
    );
  }

  setChatFinishStopReason(stopReason: string, turnId?: string): void {
    setChatFinishStopReason(this.session, stopReason, turnId);
  }

  maybeBroadcastChatFinish(context: BroadcastContext): Promise<void> {
    return maybeBroadcastChatFinish({
      chatId: context.chatId,
      session: this.session,
      broadcast: context.broadcast,
    });
  }

  currentStreamingAssistantMessage(): UIMessage | null {
    if (!this.session.uiState.currentAssistantId) {
      return null;
    }
    return (
      this.session.uiState.messages.get(
        this.session.uiState.currentAssistantId
      ) ?? null
    );
  }

  clearCurrentStreamingAssistantId(): void {
    const currentAssistantId = this.session.uiState.currentAssistantId;
    if (currentAssistantId) {
      this.session.uiState.lastAssistantId = currentAssistantId;
    }
    this.session.uiState.currentAssistantId = undefined;
  }

  setCurrentMode(modeId: string): void {
    if (this.session.modes) {
      this.session.modes.currentModeId = modeId;
    }
  }

  setCurrentModel(modelId: string): void {
    if (this.session.models) {
      this.session.models.currentModelId = modelId;
    }
  }

  cancelPendingPermissionsAsCancelled(): void {
    for (const [, pending] of this.session.pendingPermissions) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.session.pendingPermissions.clear();
  }

  assertProcessRunning(module: string, op: string, chatId: string): void {
    const stdin = this.session.proc.stdin;
    if (
      !stdin ||
      stdin.destroyed ||
      !stdin.writable ||
      this.session.proc.killed ||
      this.session.proc.exitCode !== null
    ) {
      throw new AppError({
        message: "Session is not running",
        code: "SESSION_NOT_RUNNING",
        statusCode: 409,
        module,
        op,
        details: { chatId },
      });
    }
  }

  assertConnectionOpen(module: string, op: string, chatId: string): void {
    if (this.session.conn.signal.aborted) {
      throw new AppError({
        message: "Session connection is closed",
        code: "SESSION_CONNECTION_CLOSED",
        statusCode: 409,
        module,
        op,
        details: { chatId },
      });
    }
  }

  private updateStatus(
    context: BroadcastContext,
    status: ChatStatus,
    turnId?: string
  ): Promise<void> {
    return updateChatStatus({
      chatId: context.chatId,
      session: this.session,
      broadcast: context.broadcast,
      status,
      turnId,
    });
  }
}
