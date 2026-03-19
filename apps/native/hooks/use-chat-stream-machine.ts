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
  if (params.event.type === "connected") {
    return "live";
  }

  if (params.event.type === "chat_status") {
    if (params.event.status === "inactive") {
      return params.current;
    }
    return "live";
  }

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

export function isLiveSubscriptionReady(params: {
  activeChatId: string | null;
  connectedChatId: string | null;
  streamLifecycle: StreamLifecycle;
}): boolean {
  if (!params.activeChatId) {
    return false;
  }
  return (
    params.connectedChatId === params.activeChatId ||
    params.streamLifecycle === "live"
  );
}

export function shouldApplyBootstrapHistory(
  lifecycle: StreamLifecycle
): boolean {
  return lifecycle !== "live" && lifecycle !== "idle";
}
