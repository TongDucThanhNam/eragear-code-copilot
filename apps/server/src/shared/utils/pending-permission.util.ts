import type * as acp from "@agentclientprotocol/sdk";
import type {
  BroadcastEvent,
  ChatSession,
  PendingPermissionRequest,
} from "@/shared/types/session.types";
import { buildUiMessagePartEvent } from "@/shared/utils/ui-message-part-event.util";
import { clearPermissionOptionsPart, upsertToolPart } from "./ui-message/state";
import { buildToolApprovalResponsePart } from "./ui-message/tool";

export async function settlePendingPermission(params: {
  chatId: string;
  requestId: string;
  pending: PendingPermissionRequest;
  session: ChatSession;
  response: acp.RequestPermissionResponse;
  approved: boolean;
  reason: string;
  broadcast: (chatId: string, event: BroadcastEvent) => Promise<void>;
  syncStatusAfterPermissionDecision: (turnId?: string) => Promise<void>;
}): Promise<void> {
  const {
    chatId,
    requestId,
    pending,
    session,
    response,
    approved,
    reason,
    broadcast,
    syncStatusAfterPermissionDecision,
  } = params;
  const turnId = pending.turnId ?? session.activeTurnId;

  pending.resolve(response);
  session.pendingPermissions.delete(requestId);
  await syncStatusAfterPermissionDecision(turnId);

  if (!pending.toolCallId) {
    return;
  }

  const previousToolIndex = session.uiState.toolPartIndex.get(pending.toolCallId);
  const toolPart = buildToolApprovalResponsePart({
    toolCallId: pending.toolCallId,
    toolName: pending.toolName ?? "tool",
    title: pending.title,
    input: pending.input,
    approvalId: requestId,
    approved,
    reason,
    meta: pending.meta,
  });
  const { message } = upsertToolPart({
    state: session.uiState,
    part: toolPart,
    turnId,
  });
  const nextToolIndex = session.uiState.toolPartIndex.get(pending.toolCallId);
  const updatedPermissionOptions = clearPermissionOptionsPart({
    state: session.uiState,
    requestId,
  });
  const messageWithUpdates = updatedPermissionOptions?.message ?? message;

  if (nextToolIndex && nextToolIndex.messageId === messageWithUpdates.id) {
    const previousToolLocation = previousToolIndex?.messageId
      ? previousToolIndex
      : undefined;
    const nextToolPart = messageWithUpdates.parts[nextToolIndex.partIndex];
    if (nextToolPart) {
      const partEvent = buildUiMessagePartEvent({
        state: session.uiState,
        message: messageWithUpdates,
        partIndex: nextToolIndex.partIndex,
        isNew:
          !previousToolLocation ||
          previousToolLocation.messageId !== nextToolIndex.messageId ||
          previousToolLocation.partIndex !== nextToolIndex.partIndex,
        turnId,
      });
      if (partEvent) {
        await broadcast(chatId, partEvent);
      }
    }
  }

  if (!updatedPermissionOptions || updatedPermissionOptions.partIndex < 0) {
    return;
  }
  const updatedOptionsPart =
    messageWithUpdates.parts[updatedPermissionOptions.partIndex];
  if (!updatedOptionsPart) {
    return;
  }
  const partEvent = buildUiMessagePartEvent({
    state: session.uiState,
    message: messageWithUpdates,
    partIndex: updatedPermissionOptions.partIndex,
    isNew: false,
    turnId,
  });
  if (partEvent) {
    await broadcast(chatId, partEvent);
  }
}
