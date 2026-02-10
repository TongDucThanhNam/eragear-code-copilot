import type { UIMessage } from "@repo/shared";
import type {
  BroadcastEvent,
  ChatSession,
  ChatStatus,
} from "@/shared/types/session.types";
import {
  maybeBroadcastChatFinish,
  setChatFinishStopReason,
  updateChatStatus,
} from "@/shared/utils/chat-events.util";

interface BroadcastContext {
  chatId: string;
  broadcast: (chatId: string, event: BroadcastEvent) => void;
}

export const AI_CHAT_STATUS = {
  CANCELLING: "cancelling",
  ERROR: "error",
  READY: "ready",
  SUBMITTED: "submitted",
} as const satisfies Record<string, ChatStatus>;

export class AiChatSessionAggregate {
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

  markSubmitted(context: BroadcastContext, turnId: string): void {
    this.updateStatus(context, AI_CHAT_STATUS.SUBMITTED, turnId);
  }

  markCancelling(context: BroadcastContext): void {
    this.updateStatus(context, AI_CHAT_STATUS.CANCELLING);
  }

  markError(context: BroadcastContext, turnId?: string): void {
    this.updateStatus(context, AI_CHAT_STATUS.ERROR, turnId);
  }

  markReadyIfSubmitted(context: BroadcastContext, turnId?: string): void {
    if (this.session.chatStatus !== AI_CHAT_STATUS.SUBMITTED) {
      return;
    }
    this.updateStatus(context, AI_CHAT_STATUS.READY, turnId);
  }

  setChatFinishStopReason(stopReason: string, turnId?: string): void {
    setChatFinishStopReason(this.session, stopReason, turnId);
  }

  maybeBroadcastChatFinish(context: BroadcastContext): void {
    maybeBroadcastChatFinish({
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

  private updateStatus(
    context: BroadcastContext,
    status: ChatStatus,
    turnId?: string
  ): void {
    updateChatStatus({
      chatId: context.chatId,
      session: this.session,
      broadcast: context.broadcast,
      status,
      turnId,
    });
  }
}
