import { describe, expect, test } from "bun:test";
import type { BroadcastEvent } from "@repo/shared";
import {
  isLiveSubscriptionReady,
  nextLifecycleOnChatIdChange,
  nextLifecycleOnSubscriptionError,
  nextLifecycleOnSubscriptionEvent,
  nextLifecycleOnSubscriptionStart,
  shouldApplyBootstrapHistory,
} from "./use-chat-stream-machine";

describe("use-chat-stream-machine", () => {
  test("boots into bootstrapping for active live chats", () => {
    expect(
      nextLifecycleOnChatIdChange({ hasChatId: true, readOnly: false })
    ).toBe("bootstrapping");
    expect(
      nextLifecycleOnChatIdChange({ hasChatId: true, readOnly: true })
    ).toBe("idle");
  });

  test("promotes subscribing lifecycle to live on runtime-backed events", () => {
    const event: BroadcastEvent = {
      type: "ui_message",
      message: { id: "m1", role: "assistant", parts: [] },
    };
    expect(nextLifecycleOnSubscriptionStart("bootstrapping")).toBe(
      "subscribing"
    );
    expect(
      nextLifecycleOnSubscriptionEvent({ current: "subscribing", event })
    ).toBe("live");
  });

  test("keeps inactive chat status from falsely promoting lifecycle", () => {
    expect(
      nextLifecycleOnSubscriptionEvent({
        current: "subscribing",
        event: { type: "chat_status", status: "inactive" },
      })
    ).toBe("subscribing");
  });

  test("moves non-idle lifecycle into recovering on subscription errors", () => {
    expect(nextLifecycleOnSubscriptionError("subscribing")).toBe("recovering");
    expect(nextLifecycleOnSubscriptionError("idle")).toBe("idle");
  });

  test("treats a matching connected chat or live lifecycle as ready", () => {
    expect(
      isLiveSubscriptionReady({
        activeChatId: "chat-1",
        connectedChatId: "chat-1",
        streamLifecycle: "subscribing",
      })
    ).toBe(true);
    expect(
      isLiveSubscriptionReady({
        activeChatId: "chat-1",
        connectedChatId: null,
        streamLifecycle: "live",
      })
    ).toBe(true);
    expect(
      isLiveSubscriptionReady({
        activeChatId: "chat-1",
        connectedChatId: null,
        streamLifecycle: "bootstrapping",
      })
    ).toBe(false);
  });

  test("only applies DB history before live runtime takes over", () => {
    expect(shouldApplyBootstrapHistory("bootstrapping")).toBe(true);
    expect(shouldApplyBootstrapHistory("recovering")).toBe(true);
    expect(shouldApplyBootstrapHistory("live")).toBe(false);
    expect(shouldApplyBootstrapHistory("idle")).toBe(false);
  });
});
