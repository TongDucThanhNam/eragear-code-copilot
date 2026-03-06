import { describe, expect, test } from "bun:test";
import type { BroadcastEvent } from "@repo/shared";
import {
  nextLifecycleOnChatIdChange,
  nextLifecycleOnSubscriptionError,
  nextLifecycleOnSubscriptionEvent,
  nextLifecycleOnSubscriptionStart,
  type StreamLifecycle,
} from "./use-chat-connection.machine";

describe("use-chat connection machine", () => {
  test("starts bootstrapping when a writable chatId exists", () => {
    expect(
      nextLifecycleOnChatIdChange({ hasChatId: true, readOnly: false })
    ).toBe("bootstrapping");
  });

  test("resets to idle when chatId is missing or readOnly", () => {
    expect(
      nextLifecycleOnChatIdChange({ hasChatId: false, readOnly: false })
    ).toBe("idle");
    expect(
      nextLifecycleOnChatIdChange({ hasChatId: true, readOnly: true })
    ).toBe("idle");
  });

  test("moves from bootstrapping/recovering to subscribing on start", () => {
    expect(nextLifecycleOnSubscriptionStart("bootstrapping")).toBe(
      "subscribing"
    );
    expect(nextLifecycleOnSubscriptionStart("recovering")).toBe("subscribing");
    expect(nextLifecycleOnSubscriptionStart("live")).toBe("live");
  });

  test("promotes lifecycle to live on connected/chat_status events", () => {
    const connectedEvent: BroadcastEvent = { type: "connected" };
    const statusEvent: BroadcastEvent = { type: "chat_status", status: "ready" };
    const partEvent: BroadcastEvent = {
      type: "ui_message_part",
      messageId: "msg-1",
      messageRole: "assistant",
      partIndex: 0,
      part: { type: "text", text: "hello", state: "streaming" },
      isNew: true,
    };

    expect(
      nextLifecycleOnSubscriptionEvent({
        current: "subscribing",
        event: connectedEvent,
      })
    ).toBe("live");
    expect(
      nextLifecycleOnSubscriptionEvent({
        current: "bootstrapping",
        event: statusEvent,
      })
    ).toBe("live");
    expect(
      nextLifecycleOnSubscriptionEvent({
        current: "subscribing",
        event: partEvent,
      })
    ).toBe("live");
  });

  test("moves to recovering on subscription errors when active", () => {
    const activeStates: StreamLifecycle[] = [
      "bootstrapping",
      "subscribing",
      "live",
      "recovering",
    ];
    for (const state of activeStates) {
      expect(nextLifecycleOnSubscriptionError(state)).toBe("recovering");
    }
    expect(nextLifecycleOnSubscriptionError("idle")).toBe("idle");
  });
});
