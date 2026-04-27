import { describe, expect, test } from "bun:test";
import type { BroadcastEvent, ChatStatus, UIMessage } from "@repo/shared";
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

describe("live supervisor turn adoption via turn guard", () => {
  test("after chat_finish turn-1, processes chat_status submitted turn-2 then ui_message user turn-2 — supervisor message upserted immediately", () => {
    // Simulate turn-1 completing
    let activeTurnId: string | null = "turn-1";
    const blockedTurnIds = new Set<string>();
    const completedTurnIds = new Set<string>(["turn-1"]);
    const isResuming = false;

    // chat_finish for turn-1
    const chatFinishEvent: BroadcastEvent = {
      type: "chat_finish",
      stopReason: "end_turn",
      finishReason: "stop",
      isAbort: false,
      turnId: "turn-1",
    };

    // reconcileActiveTurnIdAfterEvent keeps turn-1 active after chat_finish
    activeTurnId = reconcileActiveTurnIdAfterEvent({
      activeTurnId,
      event: chatFinishEvent,
    });
    // turn-1 is still the active turn after chat_finish
    expect(activeTurnId).toBe("turn-1");

    // status becomes ready after turn-1
    let status: ChatStatus = "ready";

    // chat_status submitted for turn-2 — should be accepted and adopt turn-2
    const chatStatusEvent: BroadcastEvent = {
      type: "chat_status",
      status: "submitted",
      turnId: "turn-2",
    };

    const guardAfterChatStatus = resolveSessionEventTurnGuard({
      activeTurnId,
      blockedTurnIds,
      event: chatStatusEvent,
      isResuming,
      status,
    });
    expect(guardAfterChatStatus).toEqual({
      ignore: false,
      nextActiveTurnId: "turn-2",
    });
    activeTurnId = guardAfterChatStatus.nextActiveTurnId;
    status = "submitted";

    // ui_message user for turn-2 — should also be accepted
    const uiMessageEvent: BroadcastEvent = {
      type: "ui_message",
      turnId: "turn-2",
      message: {
        id: "msg-supervisor-1",
        role: "user",
        parts: [
          { type: "text", text: "follow-up from supervisor", state: "done" },
        ],
      },
    };

    const guardAfterUiMessage = resolveSessionEventTurnGuard({
      activeTurnId,
      blockedTurnIds,
      event: uiMessageEvent,
      isResuming,
      status,
    });
    expect(guardAfterUiMessage).toEqual({
      ignore: false,
      nextActiveTurnId: "turn-2",
    });
    activeTurnId = guardAfterUiMessage.nextActiveTurnId;

    // Verify the guard adopted turn-2 for supervisor prompt
    expect(activeTurnId).toBe("turn-2");
    expect(guardAfterChatStatus.ignore).toBe(false);
    expect(guardAfterUiMessage.ignore).toBe(false);
  });

  test("ready + activeTurnId=turn-1 receiving chat_status streaming turn-2 adopts turn-2", () => {
    const event: BroadcastEvent = {
      type: "chat_status",
      status: "streaming",
      turnId: "turn-2",
    };

    const result = resolveSessionEventTurnGuard({
      activeTurnId: "turn-1",
      blockedTurnIds: new Set(),
      event,
      isResuming: false,
      status: "ready",
    });

    expect(result).toEqual({
      ignore: false,
      nextActiveTurnId: "turn-2",
    });
  });

  test("ready + activeTurnId=turn-1 receiving ui_message user turn-2 adopts turn-2", () => {
    const event: BroadcastEvent = {
      type: "ui_message",
      turnId: "turn-2",
      message: {
        id: "msg-supervisor-1",
        role: "user",
        parts: [
          { type: "text", text: "follow-up", state: "done" },
        ],
      },
    };

    const result = resolveSessionEventTurnGuard({
      activeTurnId: "turn-1",
      blockedTurnIds: new Set(),
      event,
      isResuming: false,
      status: "ready",
    });

    expect(result).toEqual({
      ignore: false,
      nextActiveTurnId: "turn-2",
    });
  });

  test("ready + activeTurnId=turn-1 receiving mismatched assistant ui_message turn-2 ignores it", () => {
    const event: BroadcastEvent = {
      type: "ui_message",
      turnId: "turn-2",
      message: {
        id: "msg-2",
        role: "assistant",
        parts: [{ type: "text", text: "late assistant", state: "streaming" }],
      },
    };

    const result = resolveSessionEventTurnGuard({
      activeTurnId: "turn-1",
      blockedTurnIds: new Set(),
      event,
      isResuming: false,
      status: "ready",
    });

    expect(result).toEqual({
      ignore: true,
      nextActiveTurnId: "turn-1",
    });
  });
});

describe("synced status setter prevents race on supervisor follow-up", () => {
  test("streaming->ready turn-1 then immediate submitted turn-2 then user ui_message turn-2: guard accepts turn-2", () => {
    // Simulate the race condition: statusRef is "streaming" while turn-1 is still
    // active. After processing chat_status ready turn-1 via a synced setter,
    // statusRef.current becomes "ready" synchronously. Then chat_status submitted
    // turn-2 arrives immediately — guard must accept it because statusRef is now
    // "ready", not "streaming". Finally, ui_message user turn-2 is also accepted.
    let activeTurnId: string | null = "turn-1";
    const blockedTurnIds = new Set<string>();
    const isResuming = false;

    // Initial state: streaming with turn-1 active
    let statusRef: ChatStatus = "streaming";

    // chat_status ready turn-1 — this is the first event that transitions to ready.
    // In the real synced setter, statusRef.current is set to "ready" BEFORE React
    // render, so the subsequent submitted turn-2 event sees statusRef="ready".
    const readyEvent: BroadcastEvent = {
      type: "chat_status",
      status: "ready",
      turnId: "turn-1",
    };

    // Simulate synced setter behavior: resolve next status from statusRef
    const nextStatusAfterReady =
      readyEvent.status; // "ready"
    statusRef = nextStatusAfterReady; // sync statusRef to "ready"

    const guardForReady = resolveSessionEventTurnGuard({
      activeTurnId,
      blockedTurnIds,
      event: readyEvent,
      isResuming,
      status: statusRef,
    });
    expect(guardForReady.ignore).toBe(false);
    activeTurnId = guardForReady.nextActiveTurnId ?? activeTurnId;

    // chat_status submitted turn-2 arrives immediately — with synced statusRef="ready",
    // guard should accept the new turn even though activeTurnId is still "turn-1".
    const submittedEvent: BroadcastEvent = {
      type: "chat_status",
      status: "submitted",
      turnId: "turn-2",
    };

    const guardForSubmitted = resolveSessionEventTurnGuard({
      activeTurnId,
      blockedTurnIds,
      event: submittedEvent,
      isResuming,
      status: statusRef,
    });
    expect(guardForSubmitted.ignore).toBe(false);
    expect(guardForSubmitted.nextActiveTurnId).toBe("turn-2");
    activeTurnId = guardForSubmitted.nextActiveTurnId ?? activeTurnId;

    // ui_message user turn-2 should also be accepted immediately
    const uiMessageEvent: BroadcastEvent = {
      type: "ui_message",
      turnId: "turn-2",
      message: {
        id: "msg-supervisor-1",
        role: "user",
        parts: [
          { type: "text", text: "follow-up from supervisor", state: "done" },
        ],
      },
    };

    const guardForUiMessage = resolveSessionEventTurnGuard({
      activeTurnId,
      blockedTurnIds,
      event: uiMessageEvent,
      isResuming,
      status: statusRef,
    });
    expect(guardForUiMessage.ignore).toBe(false);
    expect(guardForUiMessage.nextActiveTurnId).toBe("turn-2");
  });
});
