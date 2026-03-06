/**
 * Cancel Prompt Service
 *
 * Cancels an ongoing prompt execution in a session and resolves any pending
 * permission requests with a cancelled outcome.
 *
 * @module modules/ai/application/cancel-prompt.service
 */

import {
  finalizeToolPartAsCancelled,
  type ToolUIPart,
  type UIMessage,
} from "@repo/shared";
import type { SessionRuntimePort } from "@/modules/session";
import { assertSessionMutationLock } from "@/modules/session/application/session-runtime-lock.assert";
import { AppError } from "@/shared/errors";
import type { ChatSession } from "@/shared/types/session.types";
import { buildUiMessagePartEvent } from "@/shared/utils/ui-message-part-event.util";
import { AI_OP, HTTP_STATUS } from "./ai.constants";
import type { AiSessionRuntimePort } from "./ports/ai-session-runtime.port";
import { AiSessionRuntimeError } from "./ports/ai-session-runtime.port";

const OP = AI_OP.PROMPT_CANCEL;

export class CancelPromptService {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionGateway: AiSessionRuntimePort;

  constructor(
    sessionRuntime: SessionRuntimePort,
    sessionGateway: AiSessionRuntimePort
  ) {
    this.sessionRuntime = sessionRuntime;
    this.sessionGateway = sessionGateway;
  }

  async execute(userId: string, chatId: string) {
    const activeSession = await this.sessionRuntime.runExclusive(
      chatId,
      async (): Promise<ChatSession> => {
        assertSessionMutationLock({
          sessionRuntime: this.sessionRuntime,
          chatId,
          op: OP,
        });
        const aggregate = this.sessionGateway.requireAuthorizedRuntime({
          userId,
          chatId,
          module: "ai",
          op: OP,
        });
        await aggregate.markCancelling({
          chatId,
          broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
        });
        return aggregate.raw;
      }
    );

    try {
      await this.sessionGateway.cancelPrompt(activeSession);
    } catch (error) {
      if (
        error instanceof AiSessionRuntimeError &&
        (error.kind === "process_exited" ||
          error.kind === "session_unavailable")
      ) {
        await this.sessionGateway.stopAndCleanup({
          chatId,
          session: activeSession,
          reason: error.message || "Failed to cancel prompt",
          turnId: activeSession.activeTurnId,
          killProcess: error.kind === "process_exited",
        });
        return { ok: true };
      }

      throw new AppError({
        message:
          error instanceof Error
            ? error.message
            : "Failed to cancel active prompt",
        code: "PROMPT_CANCEL_FAILED",
        statusCode: HTTP_STATUS.BAD_GATEWAY,
        module: "ai",
        op: OP,
        cause: error,
        details: { chatId },
      });
    }

    await this.sessionRuntime.runExclusive(chatId, async () => {
      assertSessionMutationLock({
        sessionRuntime: this.sessionRuntime,
        chatId,
        op: OP,
      });
      const currentSession = this.sessionRuntime.get(chatId);
      if (!currentSession || currentSession !== activeSession) {
        return;
      }
      const cancelledToolCallIds = new Set<string>();
      const activeTurnId = currentSession.activeTurnId;
      if (activeTurnId) {
        for (const [toolCallId, location] of currentSession.uiState.toolPartIndex) {
          if (location.turnId !== activeTurnId) {
            continue;
          }
          const updated = await cancelToolPartById({
            chatId,
            session: currentSession,
            sessionRuntime: this.sessionRuntime,
            toolCallId,
            turnId: activeTurnId,
          });
          if (updated) {
            cancelledToolCallIds.add(toolCallId);
          }
        }
      }
      for (const [requestId, pending] of currentSession.pendingPermissions) {
        const turnId = pending.turnId ?? currentSession.activeTurnId;
        if (pending.toolCallId && !cancelledToolCallIds.has(pending.toolCallId)) {
          await cancelToolPartById({
            chatId,
            session: currentSession,
            sessionRuntime: this.sessionRuntime,
            toolCallId: pending.toolCallId,
            turnId,
          });
        }
        if (!pending.toolCallId) {
          continue;
        }
        const nextToolIndex = currentSession.uiState.toolPartIndex.get(
          pending.toolCallId
        );
        const message = nextToolIndex
          ? currentSession.uiState.messages.get(nextToolIndex.messageId)
          : undefined;
        if (!message) {
          continue;
        }
        const updatedPermissionOptions = clearPermissionOptionsPart(
          message,
          requestId
        );
        const messageWithUpdates = updatedPermissionOptions.message;
        if (messageWithUpdates !== message) {
          currentSession.uiState.messages.set(
            messageWithUpdates.id,
            messageWithUpdates
          );
        }
        if (updatedPermissionOptions.partIndex >= 0) {
          const optionsPart =
            messageWithUpdates.parts[updatedPermissionOptions.partIndex];
          if (optionsPart) {
            const partEvent = buildUiMessagePartEvent({
              chatId,
              message: messageWithUpdates,
              partIndex: updatedPermissionOptions.partIndex,
              isNew: false,
              turnId,
            });
            if (partEvent) {
              await this.sessionRuntime.broadcast(chatId, partEvent);
            }
          }
        }
      }
      this.sessionGateway.clearPendingPermissionsAsCancelled(currentSession);
    });
    return { ok: true };
  }
}

async function cancelToolPartById(params: {
  chatId: string;
  session: ChatSession;
  sessionRuntime: SessionRuntimePort;
  toolCallId: string;
  turnId?: string;
}): Promise<boolean> {
  const { chatId, session, sessionRuntime, toolCallId, turnId } = params;
  const existingLocation = session.uiState.toolPartIndex.get(toolCallId);
  if (!existingLocation) {
    return false;
  }
  const existingMessage = session.uiState.messages.get(existingLocation.messageId);
  if (!existingMessage) {
    session.uiState.toolPartIndex.delete(toolCallId);
    return false;
  }
  const resolvedPartIndex = findToolPartIndexByCallId(
    existingMessage,
    toolCallId,
    existingLocation.partIndex
  );
  if (resolvedPartIndex < 0) {
    session.uiState.toolPartIndex.delete(toolCallId);
    return false;
  }
  const existingPart = existingMessage.parts[resolvedPartIndex];
  if (!existingPart || !isToolPart(existingPart, toolCallId)) {
    return false;
  }
  const cancelledPart = finalizeToolPartAsCancelled(existingPart);
  if (cancelledPart === existingPart) {
    session.uiState.toolPartIndex.set(toolCallId, {
      ...existingLocation,
      partIndex: resolvedPartIndex,
      turnId: turnId ?? existingLocation.turnId,
    });
    return false;
  }
  const updatedParts = [...existingMessage.parts];
  updatedParts[resolvedPartIndex] = cancelledPart;
  const updatedMessage: UIMessage = {
    ...existingMessage,
    parts: updatedParts,
  };
  session.uiState.messages.set(updatedMessage.id, updatedMessage);
  session.uiState.toolPartIndex.set(toolCallId, {
    messageId: updatedMessage.id,
    partIndex: resolvedPartIndex,
    turnId: turnId ?? existingLocation.turnId,
  });
  const partEvent = buildUiMessagePartEvent({
    chatId,
    message: updatedMessage,
    partIndex: resolvedPartIndex,
    isNew: false,
    turnId,
  });
  if (partEvent) {
    await sessionRuntime.broadcast(chatId, partEvent);
  }
  return true;
}

function findToolPartIndexByCallId(
  message: UIMessage,
  toolCallId: string,
  preferredIndex: number
): number {
  if (isToolPart(message.parts[preferredIndex], toolCallId)) {
    return preferredIndex;
  }
  return message.parts.findIndex((part) => isToolPart(part, toolCallId));
}

function isToolPart(
  part: UIMessage["parts"][number] | undefined,
  toolCallId: string
): part is ToolUIPart {
  return Boolean(
    part &&
      part.type.startsWith("tool-") &&
      "toolCallId" in part &&
      part.toolCallId === toolCallId
  );
}

function clearPermissionOptionsPart(
  message: UIMessage,
  requestId: string
): { message: UIMessage; partIndex: number } {
  const partIndex = message.parts.findIndex((part) => {
    return (
      part.type === "data-permission-options" &&
      part.data &&
      typeof part.data === "object" &&
      (part.data as { requestId?: unknown }).requestId === requestId
    );
  });
  if (partIndex < 0) {
    return { message, partIndex: -1 };
  }
  const part = message.parts[partIndex];
  if (!part || part.type !== "data-permission-options") {
    return { message, partIndex: -1 };
  }
  const currentData =
    part.data && typeof part.data === "object"
      ? (part.data as Record<string, unknown>)
      : {};
  const scrubbedPart = {
    ...part,
    data: {
      ...currentData,
      options: [],
    },
  } satisfies UIMessage["parts"][number];
  const nextParts = [...message.parts];
  nextParts[partIndex] = scrubbedPart;
  return {
    message: {
      ...message,
      parts: nextParts,
    },
    partIndex,
  };
}
