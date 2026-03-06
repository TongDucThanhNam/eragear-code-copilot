import type { UIMessage } from "@repo/shared";
import type { SessionRuntimePort } from "@/modules/session";
import { buildUiMessagePartEvent } from "@/shared/utils/ui-message-part-event.util";
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
  turnId?: string;
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
  const event = buildUiMessagePartEvent({
    chatId,
    message,
    partIndex,
    isNew,
    turnId: params.turnId,
  });
  if (!event) {
    return;
  }

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
