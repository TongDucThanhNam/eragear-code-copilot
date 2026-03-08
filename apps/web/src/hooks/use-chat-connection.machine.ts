import type { BroadcastEvent } from "@repo/shared";

export type StreamLifecycle =
  | "idle"
  | "bootstrapping"
  | "subscribing"
  | "live"
  | "recovering";

export function nextLifecycleOnChatIdChange(params: {
  hasChatId: boolean;
  readOnly: boolean;
}): StreamLifecycle {
  if (!params.hasChatId || params.readOnly) {
    return "idle";
  }
  return "bootstrapping";
}

export function nextLifecycleOnSubscriptionStart(
  current: StreamLifecycle
): StreamLifecycle {
  if (current === "bootstrapping" || current === "recovering") {
    return "subscribing";
  }
  return current;
}

export function nextLifecycleOnSubscriptionEvent(params: {
  current: StreamLifecycle;
  event: BroadcastEvent;
}): StreamLifecycle {
  // Primary "live" signal: the server explicitly confirms connected with a
  // runtime-backed subscription.
  if (params.event.type === "connected") {
    return "live";
  }

  // chat_status promotes to "live" ONLY when the status indicates the
  // session has a running runtime (anything other than "inactive").
  // An "inactive" chat_status comes from stored-snapshot subscriptions
  // that have no runtime listener and must NOT gate-open the send flow.
  if (params.event.type === "chat_status") {
    if (
      "status" in params.event &&
      (params.event as { status?: string }).status === "inactive"
    ) {
      return params.current;
    }
    return "live";
  }

  // If we are still in the "subscribing" handshake and a data event arrives,
  // it proves the subscription is working — promote to "live" immediately so
  // ensureLiveSubscription waiters are unblocked.  This prevents the lifecycle
  // from getting stuck when the initial "connected" event is dropped or
  // re-ordered by the transport layer.
  if (params.current === "subscribing") {
    switch (params.event.type) {
      case "ui_message":
      case "ui_message_part":
      case "ui_message_part_removed":
      case "chat_finish":
      case "current_mode_update":
      case "current_model_update":
      case "config_options_update":
      case "available_commands_update":
      case "session_info_update":
        return "live";
      default:
        break;
    }
  }

  return params.current;
}

export function nextLifecycleOnSubscriptionError(
  current: StreamLifecycle
): StreamLifecycle {
  if (current === "idle") {
    return current;
  }
  return "recovering";
}
