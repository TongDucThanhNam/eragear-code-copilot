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
import type { SessionRuntimePort } from "@/modules/session";
import { createLogger } from "@/platform/logging/structured-logger";
import { updateChatStatus } from "@/shared/utils/chat-events.util";
import { createId } from "@/shared/utils/id.util";
import {
  buildToolApprovalPart,
  getToolNameFromCall,
  upsertToolPart,
} from "@/shared/utils/ui-message.util";

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
  return function handlePermissionRequest(params: {
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
    logger.debug("ACP permission request received", {
      chatId,
      requestId,
      toolCallId: toolCall.toolCallId,
      toolKind: toolCall.kind,
      toolTitle: toolCall.title ?? undefined,
      optionCount: options.length,
    });

    return new Promise<acp.RequestPermissionResponse>((resolve) => {
      const session = sessionRuntime.get(chatId);
      if (!session) {
        logger.warn("Session not found while handling permission request", {
          chatId,
          requestId,
          toolCallId: toolCall.toolCallId,
        });
        resolve({ outcome: { outcome: "cancelled" } });
        return;
      }

      const toolName = getToolNameFromCall(toolCall);
      const title = toolCall.title ?? toolCall.kind ?? toolName;
      session.pendingPermissions.set(requestId, {
        resolve: (decision: unknown) =>
          resolve(decision as acp.RequestPermissionResponse),
        options,
        toolCallId: toolCall.toolCallId,
        toolName,
        title,
        input: toolCall.rawInput,
        meta: toolCall._meta,
      });

      const publishPermissionRequest = async () => {
        await updateChatStatus({
          chatId,
          session,
          broadcast: sessionRuntime.broadcast.bind(sessionRuntime),
          status: "awaiting_permission",
        });

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
        });
        let messageWithPermissionOptions = message;
        if (options.length > 0) {
          const optionsPart = {
            type: "data-permission-options" as const,
            data: {
              requestId,
              toolCallId: toolCall.toolCallId,
              options,
            },
          };
          const existingOptionsPartIndex = message.parts.findIndex(
            (part) =>
              part.type === "data-permission-options" &&
              typeof part.data === "object" &&
              part.data !== null &&
              (part.data as { requestId?: string }).requestId === requestId
          );
          const nextParts = [...message.parts];
          if (existingOptionsPartIndex >= 0) {
            nextParts[existingOptionsPartIndex] = optionsPart;
          } else {
            nextParts.push(optionsPart);
          }
          messageWithPermissionOptions = {
            ...message,
            parts: nextParts,
          };
          session.uiState.messages.set(
            messageWithPermissionOptions.id,
            messageWithPermissionOptions
          );
        }
        await sessionRuntime.broadcast(chatId, {
          type: "ui_message",
          message: messageWithPermissionOptions,
        });
      };
      publishPermissionRequest().catch((error) => {
        if (session.pendingPermissions.has(requestId)) {
          session.pendingPermissions.delete(requestId);
        }
        logger.error("Failed to publish permission request", error as Error, {
          chatId,
          requestId,
          toolCallId: toolCall.toolCallId,
        });
        resolve({ outcome: { outcome: "cancelled" } });
      });
    });
  };
}
