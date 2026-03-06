import type { SessionRuntimePort } from "@/modules/session";

/**
 * Broadcast an append-only text delta for an existing text/reasoning part.
 *
 * Delta events are intentionally non-durable and not replay-buffered. Runtime
 * reconnects recover from the authoritative `ui_message` snapshot already held
 * in session state.
 */
export async function broadcastUiMessageDelta(params: {
  chatId: string;
  sessionRuntime: SessionRuntimePort;
  messageId: string;
  partIndex: number;
  delta: string;
  turnId?: string;
}): Promise<void> {
  if (params.delta.length === 0) {
    return;
  }

  await params.sessionRuntime.broadcast(
    params.chatId,
    {
      type: "ui_message_delta",
      messageId: params.messageId,
      partIndex: params.partIndex,
      delta: params.delta,
      ...(params.turnId ? { turnId: params.turnId } : {}),
    },
    {
      durable: false,
      retainInBuffer: false,
    }
  );
}
