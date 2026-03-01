import type { UIMessage } from "@repo/shared";
import type { SessionRuntimePort } from "@/modules/session";

/**
 * Broadcasts a single UIMessage part update to subscribers.
 *
 * This is the **primary** streaming broadcast primitive. It sends only the
 * individual part that changed — never a full `ui_message` snapshot — so
 * that clients can apply surgical React state updates with minimal
 * re-renders.
 *
 * Full `ui_message` snapshots are reserved for:
 * - Initial session state load
 * - Reconnect / late-subscriber catch-up (buffered events)
 */
export async function broadcastUiMessagePart(params: {
  chatId: string;
  sessionRuntime: SessionRuntimePort;
  message: UIMessage;
  partIndex: number;
  isNew: boolean;
}): Promise<void> {
  const { chatId, sessionRuntime, message, partIndex, isNew } = params;
  const part = message.parts[partIndex];
  if (!part) {
    return;
  }
  await sessionRuntime.broadcast(chatId, {
    type: "ui_message_part",
    messageId: message.id,
    messageRole: message.role,
    partIndex,
    part,
    isNew,
    // Include createdAt so clients can order messages during streaming
    // without waiting for the chat_finish snapshot.
    ...(typeof message.createdAt === "number"
      ? { createdAt: message.createdAt }
      : {}),
  });
}
