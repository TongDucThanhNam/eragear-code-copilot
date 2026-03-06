import { describe, expect, test } from "bun:test";
import type { BroadcastEvent } from "@repo/shared";
import {
  rememberBlockedTurnId,
  resolveSessionEventTurnGuard,
  shouldRollbackSendMessageFailure,
} from "./use-chat-turn-guards";

describe("shouldRollbackSendMessageFailure", () => {
  test("rolls back only while submit still owns the state", () => {
    expect(shouldRollbackSendMessageFailure("submitted")).toBe(true);
    expect(shouldRollbackSendMessageFailure("streaming")).toBe(false);
    expect(shouldRollbackSendMessageFailure("error")).toBe(false);
    expect(shouldRollbackSendMessageFailure("ready")).toBe(false);
  });
});

describe("rememberBlockedTurnId", () => {
  test("keeps the most recent blocked turn ids bounded", () => {
    const blocked = new Set<string>();
    for (let index = 1; index <= 20; index += 1) {
      rememberBlockedTurnId(blocked, `turn-${index}`);
    }

    expect(blocked.size).toBe(16);
    expect(blocked.has("turn-1")).toBe(false);
    expect(blocked.has("turn-20")).toBe(true);
  });
});

describe("resolveSessionEventTurnGuard", () => {
  test("adopts a live turnId while submit is still pending", () => {
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
    ).toEqual({
      ignore: false,
      nextActiveTurnId: "turn-1",
    });
  });

  test("ignores blocked late turn events after stop", () => {
    const blocked = new Set<string>(["turn-zombie"]);
    const event: BroadcastEvent = {
      type: "chat_finish",
      stopReason: "cancelled",
      finishReason: "stop",
      isAbort: true,
      turnId: "turn-zombie",
    };

    expect(
      resolveSessionEventTurnGuard({
        activeTurnId: null,
        blockedTurnIds: blocked,
        event,
        isResuming: false,
        status: "inactive",
      })
    ).toEqual({
      ignore: true,
      nextActiveTurnId: null,
    });
  });

  test("ignores mismatched turnId when another turn is active", () => {
    const event: BroadcastEvent = {
      type: "chat_status",
      status: "streaming",
      turnId: "turn-2",
    };

    expect(
      resolveSessionEventTurnGuard({
        activeTurnId: "turn-1",
        blockedTurnIds: new Set(),
        event,
        isResuming: false,
        status: "streaming",
      })
    ).toEqual({
      ignore: true,
      nextActiveTurnId: "turn-1",
    });
  });

  test("ignores blocked ui_message snapshots with an explicit stale turnId", () => {
    const event: BroadcastEvent = {
      type: "ui_message",
      turnId: "turn-zombie",
      message: {
        id: "msg-1",
        role: "assistant",
        parts: [{ type: "text", text: "late", state: "streaming" }],
      },
    };

    expect(
      resolveSessionEventTurnGuard({
        activeTurnId: null,
        blockedTurnIds: new Set(["turn-zombie"]),
        event,
        isResuming: false,
        status: "inactive",
      })
    ).toEqual({
      ignore: true,
      nextActiveTurnId: null,
    });
  });

  test("ignores terminal output with a mismatched explicit turnId", () => {
    const event: BroadcastEvent = {
      type: "terminal_output",
      terminalId: "term-1",
      data: "late stdout",
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
    ).toEqual({
      ignore: true,
      nextActiveTurnId: "turn-live",
    });
  });

  test("ignores turnless streaming parts when no turn is active", () => {
    const event: BroadcastEvent = {
      type: "ui_message_part",
      messageId: "m1",
      messageRole: "assistant",
      partIndex: 0,
      part: { type: "text", text: "late", state: "streaming" },
      isNew: false,
    };

    expect(
      resolveSessionEventTurnGuard({
        activeTurnId: null,
        blockedTurnIds: new Set(),
        event,
        isResuming: false,
        status: "inactive",
      })
    ).toEqual({
      ignore: true,
      nextActiveTurnId: null,
    });
  });

  test("accepts explicit same-turn part updates after ready while completed turn is still tracked", () => {
    const event: BroadcastEvent = {
      type: "ui_message_part",
      messageId: "m1",
      messageRole: "assistant",
      partIndex: 0,
      part: { type: "text", text: "tail", state: "done" },
      isNew: false,
      turnId: "turn-1",
    };

    expect(
      resolveSessionEventTurnGuard({
        activeTurnId: "turn-1",
        blockedTurnIds: new Set(),
        event,
        isResuming: false,
        status: "ready",
      })
    ).toEqual({
      ignore: false,
      nextActiveTurnId: "turn-1",
    });
  });

  test("allows turnless streaming parts while submit is pending", () => {
    const event: BroadcastEvent = {
      type: "ui_message_part",
      messageId: "m1",
      messageRole: "assistant",
      partIndex: 0,
      part: { type: "text", text: "early", state: "streaming" },
      isNew: false,
    };

    expect(
      resolveSessionEventTurnGuard({
        activeTurnId: null,
        blockedTurnIds: new Set(),
        event,
        isResuming: false,
        status: "submitted",
      })
    ).toEqual({
      ignore: false,
      nextActiveTurnId: null,
    });
  });
});
