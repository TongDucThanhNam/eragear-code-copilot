/**
 * ACP Permission Handler
 *
 * Implements permission request handling for agent tool calls.
 * Manages the flow of permission requests from agents to users and
 * returns user decisions back to the agent.
 *
 * @module infra/acp/permission
 */

import type * as acp from "@agentclientprotocol/sdk";
import type { UIMessage } from "@repo/shared";
import { ENV } from "@/config/environment";
import type { SessionRuntimePort } from "@/modules/session";
import { assertSessionMutationLock } from "@/modules/session/application/session-runtime-lock.assert";
import { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import { createLogger } from "@/platform/logging/structured-logger";
import { createId } from "@/shared/utils/id.util";
import {
  buildToolApprovalPart,
  getToolNameFromCall,
  upsertToolPart,
} from "@/shared/utils/ui-message.util";
import {
  recordTurnIdDrop,
  recordTurnIdResolution,
} from "./turn-id-observability";
import { broadcastUiMessagePart } from "./ui-message-part";
import { resolveToolCallTurnId } from "./update-turn-id";

const logger = createLogger("Debug");

/**
 * Creates a permission request handler for a session runtime
 *
 * @param sessionRuntime - The session runtime port for broadcasting and session access
 * @returns Handler function for processing permission requests
 *
 * @example
 * ```typescript
 * const handlePermission = createPermissionHandler(sessionRuntime);
 * const response = await handlePermission({
 *   chatId: "session-123",
 *   isReplayingHistory: false,
 *   request: { toolCall: {...}, options: [...] },
 * });
 * ```
 */
export function createPermissionHandler(sessionRuntime: SessionRuntimePort) {
  return async function handlePermissionRequest(params: {
    chatId: string;
    isReplayingHistory: boolean;
    request: acp.RequestPermissionRequest;
  }): Promise<acp.RequestPermissionResponse> {
    const { chatId, isReplayingHistory, request } = params;
    const { toolCall, options } = request;

    // Skip permission requests during history replay
    if (isReplayingHistory) {
      logger.debug("Ignoring permission request during history replay", {
        chatId,
        toolCallId: toolCall.toolCallId,
      });
      return Promise.resolve({ outcome: { outcome: "cancelled" } });
    }

    const requestId = createId("req");
    const turnIdResolution = resolveToolCallTurnId(toolCall);
    const cancelledResponse: acp.RequestPermissionResponse = {
      outcome: { outcome: "cancelled" },
    };
    recordTurnIdResolution("permissionRequest", turnIdResolution.source);
    if (
      ENV.acpTurnIdPolicy === "require-native" &&
      turnIdResolution.source !== "native"
    ) {
      logger.warn(
        "Cancelling ACP permission request without native turnId under strict policy",
        {
          chatId,
          toolCallId: toolCall.toolCallId,
          turnIdSource: turnIdResolution.source,
        }
      );
      recordTurnIdDrop("requireNativePolicy");
      return Promise.resolve(cancelledResponse);
    }
    logger.debug("ACP permission request received", {
      chatId,
      requestId,
      toolCallId: toolCall.toolCallId,
      toolKind: toolCall.kind,
      toolTitle: toolCall.title ?? undefined,
      optionCount: options.length,
    });

    let settled = false;
    let resolveResponse: (value: acp.RequestPermissionResponse) => void = () =>
      undefined;
    const responsePromise = new Promise<acp.RequestPermissionResponse>(
      (resolve) => {
        resolveResponse = resolve;
      }
    );
    const resolveOnce = (decision: acp.RequestPermissionResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      resolveResponse(decision);
    };

    await sessionRuntime.runExclusive(chatId, async () => {
      assertSessionMutationLock({
        sessionRuntime,
        chatId,
        op: "acp.request_permission",
      });
      const session = sessionRuntime.get(chatId);
      if (!session) {
        logger.warn("Session not found while handling permission request", {
          chatId,
          requestId,
          toolCallId: toolCall.toolCallId,
        });
        resolveOnce(cancelledResponse);
        return;
      }

      const toolName = getToolNameFromCall(toolCall);
      const title = toolCall.title ?? toolCall.kind ?? toolName;
      const eventTurnId = turnIdResolution.turnId ?? session.activeTurnId;
      if (
        shouldCancelPermissionRequestForTurn({
          chatId,
          requestId,
          toolCallId: toolCall.toolCallId,
          eventTurnId,
          activeTurnId: session.activeTurnId,
          resolveOnce,
          cancelledResponse,
        })
      ) {
        return;
      }

      registerPendingPermission({
        session,
        requestId,
        resolveOnce,
        options,
        toolCall,
        toolName,
        title,
        turnId: eventTurnId,
      });

      try {
        await publishPermissionRequestUi({
          chatId,
          requestId,
          session,
          sessionRuntime,
          toolCall,
          toolName,
          title,
          options,
          turnId: eventTurnId,
        });
      } catch (error) {
        if (session.pendingPermissions.has(requestId)) {
          session.pendingPermissions.delete(requestId);
        }
        logger.error("Failed to publish permission request", error as Error, {
          chatId,
          requestId,
          toolCallId: toolCall.toolCallId,
        });
        resolveOnce(cancelledResponse);
      }
    });

    return await responsePromise;
  };
}

function shouldCancelPermissionRequestForTurn(params: {
  chatId: string;
  requestId: string;
  toolCallId: string;
  eventTurnId: string | undefined;
  activeTurnId: string | undefined;
  resolveOnce: (decision: acp.RequestPermissionResponse) => void;
  cancelledResponse: acp.RequestPermissionResponse;
}): boolean {
  const {
    chatId,
    requestId,
    toolCallId,
    eventTurnId,
    activeTurnId,
    resolveOnce,
    cancelledResponse,
  } = params;
  if (!eventTurnId) {
    return false;
  }
  if (!activeTurnId) {
    logger.warn(
      "Cancelling late ACP permission request after active turn cleared",
      {
        chatId,
        requestId,
        toolCallId,
        turnId: eventTurnId,
      }
    );
    recordTurnIdDrop("lateAfterTurnCleared");
    resolveOnce(cancelledResponse);
    return true;
  }
  if (activeTurnId === eventTurnId) {
    return false;
  }
  logger.warn(
    "Cancelling stale ACP permission request with mismatched turnId",
    {
      chatId,
      requestId,
      toolCallId,
      turnId: eventTurnId,
      activeTurnId,
    }
  );
  recordTurnIdDrop("staleTurnMismatch");
  resolveOnce(cancelledResponse);
  return true;
}

function registerPendingPermission(params: {
  session: NonNullable<ReturnType<SessionRuntimePort["get"]>>;
  requestId: string;
  resolveOnce: (decision: acp.RequestPermissionResponse) => void;
  options: acp.RequestPermissionRequest["options"];
  toolCall: acp.RequestPermissionRequest["toolCall"];
  toolName: string;
  title: string;
  turnId?: string;
}): void {
  const {
    session,
    requestId,
    resolveOnce,
    options,
    toolCall,
    toolName,
    title,
    turnId,
  } = params;
  session.pendingPermissions.set(requestId, {
    resolve: (decision: unknown) => {
      resolveOnce(decision as acp.RequestPermissionResponse);
    },
    options,
    toolCallId: toolCall.toolCallId,
    toolName,
    title,
    input: toolCall.rawInput,
    meta: toolCall._meta,
    turnId,
  });
}

async function publishPermissionRequestUi(params: {
  chatId: string;
  requestId: string;
  session: NonNullable<ReturnType<SessionRuntimePort["get"]>>;
  sessionRuntime: SessionRuntimePort;
  toolCall: acp.RequestPermissionRequest["toolCall"];
  toolName: string;
  title: string;
  options: acp.RequestPermissionRequest["options"];
  turnId?: string;
}): Promise<void> {
  const {
    chatId,
    requestId,
    session,
    sessionRuntime,
    toolCall,
    toolName,
    title,
    options,
    turnId,
  } = params;
  const runtime = new SessionRuntimeEntity(session);
  await runtime.markAwaitingPermission({
    chatId,
    broadcast: sessionRuntime.broadcast.bind(sessionRuntime),
  });

  const previousToolIndex = session.uiState.toolPartIndex.get(
    toolCall.toolCallId
  );
  const previousOptionsPartIndex = findPermissionOptionsPartIndex(
    session.uiState.messages.get(session.uiState.currentAssistantId ?? "") ??
      null,
    requestId
  );
  const toolPart = buildToolApprovalPart({
    toolCallId: toolCall.toolCallId,
    toolName,
    title,
    input: toolCall.rawInput,
    approvalId: requestId,
    meta: toolCall._meta,
  });
  const { message } = upsertToolPart({
    state: session.uiState,
    messageId: session.uiState.currentAssistantId,
    part: toolPart,
    turnId,
  });
  const { messageWithPermissionOptions, optionsPartIndex } =
    upsertPermissionOptionsPart({
      message,
      requestId,
      toolCallId: toolCall.toolCallId,
      options,
      session,
    });
  const nextToolIndex = session.uiState.toolPartIndex.get(toolCall.toolCallId);
  if (
    nextToolIndex &&
    nextToolIndex.messageId === messageWithPermissionOptions.id
  ) {
    await broadcastUiMessagePart({
      chatId,
      sessionRuntime,
      message: messageWithPermissionOptions,
      partIndex: nextToolIndex.partIndex,
      isNew:
        !previousToolIndex ||
        previousToolIndex.messageId !== nextToolIndex.messageId ||
        previousToolIndex.partIndex !== nextToolIndex.partIndex,
      turnId,
    });
  }
  if (optionsPartIndex < 0) {
    return;
  }
  await broadcastUiMessagePart({
    chatId,
    sessionRuntime,
    message: messageWithPermissionOptions,
    partIndex: optionsPartIndex,
    isNew: previousOptionsPartIndex < 0,
    turnId,
  });
}

function upsertPermissionOptionsPart(params: {
  message: UIMessage;
  requestId: string;
  toolCallId: string;
  options: acp.RequestPermissionRequest["options"];
  session: NonNullable<ReturnType<SessionRuntimePort["get"]>>;
}): {
  messageWithPermissionOptions: UIMessage;
  optionsPartIndex: number;
} {
  const { message, requestId, toolCallId, options, session } = params;
  if (options.length === 0) {
    return {
      messageWithPermissionOptions: message,
      optionsPartIndex: -1,
    };
  }

  const optionsPart = {
    type: "data-permission-options" as const,
    data: {
      requestId,
      toolCallId,
      options,
    },
  };
  const existingOptionsPartIndex = findPermissionOptionsPartIndex(
    message,
    requestId
  );
  const nextParts = [...message.parts];
  if (existingOptionsPartIndex >= 0) {
    nextParts[existingOptionsPartIndex] = optionsPart;
  } else {
    nextParts.push(optionsPart);
  }
  const messageWithPermissionOptions = {
    ...message,
    parts: nextParts,
  };
  session.uiState.messages.set(
    messageWithPermissionOptions.id,
    messageWithPermissionOptions
  );
  return {
    messageWithPermissionOptions,
    optionsPartIndex: findPermissionOptionsPartIndex(
      messageWithPermissionOptions,
      requestId
    ),
  };
}

function findPermissionOptionsPartIndex(
  message: UIMessage | null,
  requestId: string
): number {
  if (!message) {
    return -1;
  }
  return message.parts.findIndex(
    (part) =>
      part.type === "data-permission-options" &&
      typeof part.data === "object" &&
      part.data !== null &&
      (part.data as { requestId?: string }).requestId === requestId
  );
}
