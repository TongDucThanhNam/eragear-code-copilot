import { describe, expect, test } from "bun:test";
import type { ChatStatus, UIMessage } from "@repo/shared";
import {
  applyPartUpdate,
  finalizeStreamingMessagesInState,
  replaceMessagesState,
} from "./use-chat-message-state";
import {
  getChatFinishHistoryReloadDecision,
  reconcileActiveTurnIdAfterEvent,
  reconcileMessageUpsertAfterStatus,
  shouldFinalizeAfterReadyStatus,
} from "./use-chat-session-event-handler";
import { resolveSessionEventTurnGuard } from "./use-chat-turn-guards";

function reconcileMessage(
  current: UIMessage[],
  incoming: UIMessage,
  status: ChatStatus
) {
  const state = replaceMessagesState(current);
  return reconcileMessageUpsertAfterStatus(state, incoming, status);
}

describe("reconcileMessageUpsertAfterStatus", () => {
  test("finalizes late assistant text snapshots after chat is ready", () => {
    const next = reconcileMessage(
      [
        {
          id: "m1",
          role: "assistant",
          parts: [{ type: "text", text: "draft", state: "done" }],
        },
      ],
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "draft v2", state: "streaming" }],
      },
      "ready"
    );

    expect(next.byId.get("m1")?.parts).toEqual([
      { type: "text", text: "draft v2", state: "done" },
    ]);
  });

  test("finalizes late tool snapshots after chat is inactive", () => {
    const next = reconcileMessage(
      [],
      {
        id: "m2",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "tool-1",
            state: "input-available",
            input: { cmd: "ls" },
          },
        ],
      },
      "inactive"
    );

    expect(next.byId.get("m2")?.parts).toEqual([
      {
        type: "tool-bash",
        toolCallId: "tool-1",
        state: "output-available",
        input: { cmd: "ls" },
        output: null,
        preliminary: true,
      },
    ]);
  });

  test("preserves approval-requested tool snapshots after chat is ready", () => {
    const next = reconcileMessage(
      [],
      {
        id: "m-permission",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "tool-2",
            state: "approval-requested",
            input: { cmd: "cat secrets.txt" },
            approval: { id: "req-2" },
          },
        ],
      },
      "ready"
    );

    expect(next.byId.get("m-permission")?.parts).toEqual([
      {
        type: "tool-bash",
        toolCallId: "tool-2",
        state: "approval-requested",
        input: { cmd: "cat secrets.txt" },
        approval: { id: "req-2" },
      },
    ]);
  });

  test("keeps streaming state untouched while chat is still streaming", () => {
    const next = reconcileMessage(
      [],
      {
        id: "m3",
        role: "assistant",
        parts: [{ type: "text", text: "still going", state: "streaming" }],
      },
      "streaming"
    );

    expect(next.byId.get("m3")?.parts).toEqual([
      { type: "text", text: "still going", state: "streaming" },
    ]);
  });
});

describe("reconcileActiveTurnIdAfterEvent", () => {
  test("keeps completed turn id after chat_finish so late same-turn updates are still accepted", () => {
    expect(
      reconcileActiveTurnIdAfterEvent({
        activeTurnId: "turn-1",
        event: {
          type: "chat_finish",
          stopReason: "end_turn",
          finishReason: "stop",
          isAbort: false,
          turnId: "turn-1",
        },
      })
    ).toBe("turn-1");
  });

  test("keeps completed turn id after ready status to avoid truncating tail part updates", () => {
    expect(
      reconcileActiveTurnIdAfterEvent({
        activeTurnId: "turn-1",
        event: {
          type: "chat_status",
          status: "ready",
          turnId: "turn-1",
        },
      })
    ).toBe("turn-1");
  });

  test("clears active turn on stream error", () => {
    expect(
      reconcileActiveTurnIdAfterEvent({
        activeTurnId: "turn-1",
        event: {
          type: "error",
          error: "socket closed",
        },
      })
    ).toBeNull();
  });

  test("preserves same-turn tail part update after ready without truncating text", () => {
    const readyEvent = {
      type: "chat_status" as const,
      status: "ready" as const,
      turnId: "turn-1",
    };
    const latePartEvent = {
      type: "ui_message_part" as const,
      messageId: "m1",
      messageRole: "assistant" as const,
      partIndex: 0,
      part: { type: "text" as const, text: "Hello world", state: "done" as const },
      isNew: false,
      turnId: "turn-1",
    };

    let activeTurnId: string | null = "turn-1";
    let status: ChatStatus = "streaming";
    let state = replaceMessagesState([
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello", state: "streaming" }],
      },
    ]);

    const readyGuard = resolveSessionEventTurnGuard({
      activeTurnId,
      blockedTurnIds: new Set(),
      event: readyEvent,
      isResuming: false,
      status,
    });
    expect(readyGuard.ignore).toBe(false);
    activeTurnId = reconcileActiveTurnIdAfterEvent({
      activeTurnId,
      event: readyEvent,
    });
    state = finalizeStreamingMessagesInState(state);
    status = "ready";

    const partGuard = resolveSessionEventTurnGuard({
      activeTurnId,
      blockedTurnIds: new Set(),
      event: latePartEvent,
      isResuming: false,
      status,
    });
    expect(partGuard).toEqual({
      ignore: false,
      nextActiveTurnId: "turn-1",
    });

    state = applyPartUpdate(state, {
      messageId: latePartEvent.messageId,
      messageRole: latePartEvent.messageRole,
      partIndex: latePartEvent.partIndex,
      part: latePartEvent.part,
      isNew: latePartEvent.isNew,
    });

    expect(state.byId.get("m1")?.parts).toEqual([
      { type: "text", text: "Hello world", state: "done" },
    ]);
  });
});

describe("getChatFinishHistoryReloadDecision", () => {
  test("requests history reload when finish arrives without any local messages", () => {
    const decision = getChatFinishHistoryReloadDecision({
      event: {
        type: "chat_finish",
        stopReason: "end_turn",
        finishReason: "stop",
        isAbort: false,
        messageId: "m-finish",
        turnId: "turn-1",
      },
      state: replaceMessagesState([]),
    });

    expect(decision).toEqual({
      shouldReload: true,
      reason: "empty_message_state",
      resolvedMessageId: "m-finish",
    });
  });

  test("requests history reload when finish message id is missing from local state", () => {
    const decision = getChatFinishHistoryReloadDecision({
      event: {
        type: "chat_finish",
        stopReason: "end_turn",
        finishReason: "stop",
        isAbort: false,
        messageId: "m-finish",
        turnId: "turn-1",
      },
      state: replaceMessagesState([
        {
          id: "m-user",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
      ]),
    });

    expect(decision).toEqual({
      shouldReload: true,
      reason: "missing_finished_message",
      resolvedMessageId: "m-finish",
    });
  });

  test("requests history reload when finish omits embedded message snapshot", () => {
    const decision = getChatFinishHistoryReloadDecision({
      event: {
        type: "chat_finish",
        stopReason: "end_turn",
        finishReason: "stop",
        isAbort: false,
        messageId: "m-finish",
        turnId: "turn-1",
      },
      state: replaceMessagesState([
        {
          id: "m-user",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
        {
          id: "m-finish",
          role: "assistant",
          parts: [{ type: "text", text: "done", state: "done" }],
        },
      ]),
    });

    expect(decision).toEqual({
      shouldReload: true,
      reason: "missing_embedded_finish_message",
      resolvedMessageId: "m-finish",
    });
  });

  test("skips history reload when finish embeds the assistant snapshot", () => {
    const decision = getChatFinishHistoryReloadDecision({
      event: {
        type: "chat_finish",
        stopReason: "end_turn",
        finishReason: "stop",
        isAbort: false,
        messageId: "m-finish",
        message: {
          id: "m-finish",
          role: "assistant",
          parts: [{ type: "text", text: "done", state: "done" }],
        },
        turnId: "turn-1",
      },
      state: replaceMessagesState([
        {
          id: "m-user",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
        {
          id: "m-finish",
          role: "assistant",
          parts: [{ type: "text", text: "done", state: "done" }],
        },
      ]),
    });

    expect(decision).toEqual({
      shouldReload: false,
      reason: null,
      resolvedMessageId: "m-finish",
    });
  });
});

describe("shouldFinalizeAfterReadyStatus", () => {
  test("skips ready-finalize when the same turn already completed via chat_finish", () => {
    expect(
      shouldFinalizeAfterReadyStatus({
        event: {
          type: "chat_status",
          status: "ready",
          turnId: "turn-1",
        },
        completedTurnIds: new Set(["turn-1"]),
      })
    ).toBe(false);
  });

  test("keeps ready-finalize when no chat_finish was observed for the turn", () => {
    expect(
      shouldFinalizeAfterReadyStatus({
        event: {
          type: "chat_status",
          status: "ready",
          turnId: "turn-2",
        },
        completedTurnIds: new Set(["turn-1"]),
      })
    ).toBe(true);
  });
});
