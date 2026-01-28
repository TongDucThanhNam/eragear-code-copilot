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
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import { createId } from "@/shared/utils/id.util";

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
      console.log(
        `[Server] Ignoring permission request during history replay for ${chatId}`
      );
      return Promise.resolve({ outcome: { outcome: "cancelled" } });
    }

    const requestId = createId("req");
    console.log(`[Server] Requesting permission: ${requestId}`, toolCall);
    console.log(
      "[Server] Permission options:",
      JSON.stringify(options, null, 2)
    );

    return new Promise<acp.RequestPermissionResponse>((resolve) => {
      const session = sessionRuntime.get(chatId);
      if (!session) {
        console.log("[Server] Session not found, rejecting permission");
        resolve({ outcome: { outcome: "cancelled" } });
        return;
      }

      // Store the resolve function to be called when user responds
      session.pendingPermissions.set(requestId, {
        resolve: (decision: unknown) =>
          resolve(decision as acp.RequestPermissionResponse),
        options,
      });

      // Broadcast permission request to the client
      sessionRuntime.broadcast(chatId, {
        type: "request_permission",
        requestId,
        toolCall,
        options,
      });
    });
  };
}
