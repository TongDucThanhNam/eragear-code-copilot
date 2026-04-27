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
import type { PendingPermissionRequest } from "@/shared/types/session.types";
import { createId } from "@/shared/utils/id.util";
import { settlePendingPermission } from "@/shared/utils/pending-permission.util";
import {
  buildToolApprovalPart,
  getToolNameFromCall,
  upsertToolPart,
} from "@/shared/utils/ui-message.util";
import { flushThrottledBroadcasts } from "./broadcast-throttle";
import {
  recordTurnIdDrop,
  recordTurnIdResolution,
} from "./turn-id-observability";
import { broadcastUiMessagePart } from "./ui-message-part";
import { resolveToolCallTurnId } from "./update-turn-id";

const logger = createLogger("Debug");
const CANCELLED_PERMISSION_RESPONSE: acp.RequestPermissionResponse = {
  outcome: { outcome: "cancelled" },
};

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
export function createPermissionHandler(
  sessionRuntime: SessionRuntimePort,
  handlerOptions?: {
    autoResolver?: (input: {
      chatId: string;
      requestId: string;
    }) => Promise<void>;
  }
) {
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
      return Promise.resolve(CANCELLED_PERMISSION_RESPONSE);
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
    let permissionTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
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
      if (permissionTimeoutHandle) {
        clearTimeout(permissionTimeoutHandle);
        permissionTimeoutHandle = undefined;
      }
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
        resolveOnce(CANCELLED_PERMISSION_RESPONSE);
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
          cancelledResponse: CANCELLED_PERMISSION_RESPONSE,
        })
      ) {
        return;
      }

      const pending = registerPendingPermission({
        session,
        requestId,
        resolveOnce,
        options,
        toolCall,
        toolName,
        title,
        turnId: eventTurnId,
      });
      permissionTimeoutHandle = setTimeout(() => {
        expirePendingPermissionRequest({
          chatId,
          requestId,
          toolCallId: toolCall.toolCallId,
          timeoutMs: ENV.acpPermissionRequestTimeoutMs,
          sessionRuntime,
        });
      }, ENV.acpPermissionRequestTimeoutMs);
      pending.timeoutHandle = permissionTimeoutHandle;

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
        if (handlerOptions?.autoResolver) {
          queueMicrotask(() => {
            handlerOptions
              .autoResolver?.({ chatId, requestId })
              .catch((error: unknown) => {
                logger.warn("ACP permission auto resolver failed", {
                  chatId,
                  requestId,
                  error: error instanceof Error ? error.message : String(error),
                });
              });
          });
        }
      } catch (error) {
        removePendingPermission(session, requestId);
        logger.error("Failed to publish permission request", error as Error, {
          chatId,
          requestId,
          toolCallId: toolCall.toolCallId,
        });
        resolveOnce(CANCELLED_PERMISSION_RESPONSE);
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
}): PendingPermissionRequest {
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
  const pending: PendingPermissionRequest = {
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
  };
  session.pendingPermissions.set(requestId, pending);
  return pending;
}

function clearPendingPermissionTimer(
  pending: { timeoutHandle?: ReturnType<typeof setTimeout> } | undefined
): void {
  if (!pending?.timeoutHandle) {
    return;
  }
  clearTimeout(pending.timeoutHandle);
  pending.timeoutHandle = undefined;
}

function removePendingPermission(
  session: NonNullable<ReturnType<SessionRuntimePort["get"]>>,
  requestId: string
): boolean {
  const pending = session.pendingPermissions.get(requestId);
  if (!pending) {
    return false;
  }
  clearPendingPermissionTimer(pending);
  return session.pendingPermissions.delete(requestId);
}

async function expirePendingPermissionRequest(params: {
  chatId: string;
  requestId: string;
  toolCallId: string;
  timeoutMs: number;
  sessionRuntime: SessionRuntimePort;
}): Promise<void> {
  const { chatId, requestId, toolCallId, timeoutMs, sessionRuntime } = params;
  await sessionRuntime.runExclusive(chatId, async () => {
    assertSessionMutationLock({
      sessionRuntime,
      chatId,
      op: "acp.request_permission.timeout",
    });
    const session = sessionRuntime.get(chatId);
    if (!session) {
      return;
    }
    const pending = session.pendingPermissions.get(requestId);
    if (!pending) {
      return;
    }
    clearPendingPermissionTimer(pending);
    logger.warn("ACP permission request timed out", {
      chatId,
      requestId,
      toolCallId,
      timeoutMs,
      turnId: pending.turnId ?? session.activeTurnId,
    });
    const runtime = new SessionRuntimeEntity(session);
    await settlePendingPermission({
      chatId,
      requestId,
      pending,
      session,
      response: CANCELLED_PERMISSION_RESPONSE,
      approved: false,
      reason: "timeout",
      broadcast: sessionRuntime.broadcast.bind(sessionRuntime),
      syncStatusAfterPermissionDecision: (turnId) =>
        runtime.syncStatusAfterPermissionDecision(
          {
            chatId,
            broadcast: sessionRuntime.broadcast.bind(sessionRuntime),
          },
          turnId
        ),
    });
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
  // Permission requests are authoritative turn transitions. Flush any
  // coalesced text/reasoning deltas first so clients observe the tool
  // approval state after the latest streamed assistant content.
  await flushThrottledBroadcasts(chatId);
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
