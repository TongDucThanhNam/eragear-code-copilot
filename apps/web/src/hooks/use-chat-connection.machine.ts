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
  if (params.event.type === "connected" || params.event.type === "chat_status") {
    return "live";
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
