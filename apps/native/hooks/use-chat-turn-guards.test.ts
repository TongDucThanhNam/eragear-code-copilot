import { describe, expect, test } from "bun:test";
import type { BroadcastEvent } from "@repo/shared";
import {
  hasObservedTurnCompletion,
  rememberBlockedTurnId,
  rememberCompletedTurnId,
  resolveSessionEventTurnGuard,
  shouldRollbackSendMessageFailure,
} from "./use-chat-turn-guards";

describe("use-chat-turn-guards", () => {
  test("adopts a live turn while submit is pending", () => {
    const event: BroadcastEvent = {
      type: "chat_status",
      status: "streaming",
      turnId: "turn-1",
    };
    expect(
      resolveSessionEventTurnGuard({
        activeTurnId: null,
        blockedTurnIds: new Set(),
        event,
        isResuming: false,
        status: "submitted",
      })
    ).toEqual({ ignore: false, nextActiveTurnId: "turn-1" });
  });

  test("ignores mismatched turn events while another turn is active", () => {
    const event: BroadcastEvent = {
      type: "ui_message_part",
      messageId: "msg-1",
      messageRole: "assistant",
      partIndex: 0,
      part: { type: "text", text: "late", state: "streaming" },
      isNew: false,
      turnId: "turn-old",
    };
    expect(
      resolveSessionEventTurnGuard({
        activeTurnId: "turn-live",
        blockedTurnIds: new Set(),
        event,
        isResuming: false,
        status: "streaming",
      })
    ).toEqual({ ignore: true, nextActiveTurnId: "turn-live" });
  });

  test("ignores blocked zombie turns", () => {
    const blocked = new Set<string>();
    rememberBlockedTurnId(blocked, "turn-zombie");
    const event: BroadcastEvent = {
      type: "chat_finish",
      stopReason: "end_turn",
      finishReason: "stop",
      isAbort: false,
      turnId: "turn-zombie",
    };
    expect(
      resolveSessionEventTurnGuard({
        activeTurnId: null,
        blockedTurnIds: blocked,
        event,
        isResuming: false,
        status: "ready",
      })
    ).toEqual({ ignore: true, nextActiveTurnId: null });
  });

  test("tracks completed turns and send rollback only while still submitted", () => {
    const completed = new Set<string>();
    rememberCompletedTurnId(completed, "turn-1");
    expect(hasObservedTurnCompletion(completed, "turn-1")).toBe(true);
    expect(shouldRollbackSendMessageFailure("submitted")).toBe(true);
    expect(shouldRollbackSendMessageFailure("streaming")).toBe(false);
  });
});
