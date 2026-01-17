import type * as acp from "@agentclientprotocol/sdk";
import { broadcastToSession, chats } from "../../session/events";
import { createId } from "../../utils/id";

export function handlePermissionRequest(params: {
  chatId: string;
  isReplayingHistory: boolean;
  request: acp.RequestPermissionRequest;
}): Promise<acp.RequestPermissionResponse> {
  const { chatId, isReplayingHistory, request } = params;
  const { toolCall, options } = request;

  if (isReplayingHistory) {
    console.log(
      `[Server] Ignoring permission request during history replay for ${chatId}`
    );
    return Promise.resolve({ outcome: { outcome: "cancelled" } });
  }

  const requestId = createId("req");
  console.log(`[Server] Requesting permission: ${requestId}`, toolCall);
  console.log("[Server] Permission options:", JSON.stringify(options, null, 2));

  return new Promise<acp.RequestPermissionResponse>((resolve) => {
    const session = chats.get(chatId);
    if (!session) {
      console.log("[Server] Session not found, rejecting permission");
      resolve({ outcome: { outcome: "cancelled" } });
      return;
    }

    session.pendingPermissions.set(requestId, {
      resolve: (decision: acp.RequestPermissionResponse) => {
        resolve(decision);
      },
      options,
    });

    broadcastToSession(chatId, {
      type: "request_permission",
      requestId,
      toolCall,
      options,
    });
  });
}
