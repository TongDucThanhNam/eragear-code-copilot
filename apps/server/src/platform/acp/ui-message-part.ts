import type { UIMessage } from "@repo/shared";
import type { SessionRuntimePort } from "@/modules/session";
import { scheduleThrottledBroadcast } from "./broadcast-throttle";

/**
 * Broadcasts a single UIMessage part update to subscribers.
 *
 * This is the **primary** streaming broadcast primitive. It sends only the
 * individual part that changed — never a full `ui_message` snapshot — so
 * that clients can apply surgical React state updates with minimal
 * re-renders.
 *
 * When `immediate` is `false` the broadcast is coalesced via a per-part
 * throttle (~80 ms). This is the preferred mode for high-frequency
 * text/reasoning stream chunks. Callers **must** call
 * `flushThrottledBroadcasts(chatId)` before emitting any authoritative
 * event (finalize, tool-call, plan) to preserve event ordering.
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
  /**
   * When `false`, the broadcast is throttled and coalesced with nearby
   * chunks for the same part. Defaults to `true` (send immediately).
   */
  immediate?: boolean;
}): Promise<void> {
  const {
    chatId,
    sessionRuntime,
    message,
    partIndex,
    isNew,
    immediate = true,
  } = params;
  const part = message.parts[partIndex];
  if (!part) {
    return;
  }

  const event = {
    type: "ui_message_part" as const,
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
  };

  const options = {
    durable: false,
    retainInBuffer: true,
  };

  if (!immediate) {
    scheduleThrottledBroadcast({
      chatId,
      messageId: message.id,
      partIndex,
      isNew,
      sessionRuntime,
      event,
      options,
    });
    return;
  }

  await sessionRuntime.broadcast(chatId, event, options);
}
