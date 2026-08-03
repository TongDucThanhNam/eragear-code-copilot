import { describe, expect, test } from "bun:test";
import {
  CHAT_VIRTUALIZER_CONFIG,
  type ChatVirtualTail,
  getChatVirtualItemEstimate,
  getChatVirtualItemKey,
  type InitialChatScrollState,
  reconcileInitialChatScroll,
  resolveChatVirtualItem,
  shouldFollowChatTailReplacement,
} from "./chat-messages-virtualization";

function messageKeys(
  chatId: string,
  messageIds: readonly string[],
  hasLoadOlder: boolean
): string[] {
  const offset = hasLoadOlder ? 1 : 0;
  return messageIds.map((_, messageIndex) =>
    getChatVirtualItemKey(
      chatId,
      resolveChatVirtualItem(messageIndex + offset, messageIds, hasLoadOlder)
    )
  );
}

describe("chat message virtualization contract", () => {
  test("keeps the production end-anchor configuration explicit", () => {
    expect(CHAT_VIRTUALIZER_CONFIG).toEqual({
      anchorTo: "end",
      followOnAppend: true,
      overscan: 8,
      scrollEndThreshold: 96,
    });
  });

  test("keeps existing message keys stable when older history is prepended", () => {
    const currentIds = ["message-2", "message-3"];
    const currentKeys = messageKeys("chat-1", currentIds, true);
    const prependedKeys = messageKeys(
      "chat-1",
      ["message-1", ...currentIds],
      true
    );

    expect(prependedKeys.slice(1)).toEqual(currentKeys);
  });

  test("namespaces message and synthetic row keys by chat", () => {
    const message = resolveChatVirtualItem(0, ["message-1"], false);
    const loadOlder = resolveChatVirtualItem(0, ["message-1"], true);
    const thinking = resolveChatVirtualItem(1, ["message-1"], false);

    expect(getChatVirtualItemKey("chat-1", message)).not.toBe(
      getChatVirtualItemKey("chat-2", message)
    );
    expect(
      new Set([
        getChatVirtualItemKey("chat-1", message),
        getChatVirtualItemKey("chat-1", loadOlder),
        getChatVirtualItemKey("chat-1", thinking),
      ]).size
    ).toBe(3);
  });

  test("uses row-specific estimates for dynamic measurement startup", () => {
    expect(
      getChatVirtualItemEstimate(resolveChatVirtualItem(0, ["m1"], true))
    ).toBe(48);
    expect(
      getChatVirtualItemEstimate(resolveChatVirtualItem(1, ["m1"], true))
    ).toBe(180);
    expect(
      getChatVirtualItemEstimate(resolveChatVirtualItem(2, ["m1"], true))
    ).toBe(72);
  });
});

describe("initial chat scroll reconciliation", () => {
  test("waits for asynchronously loaded history and scrolls exactly once", () => {
    const initial: InitialChatScrollState = {
      chatId: undefined,
      pending: true,
    };
    const empty = reconcileInitialChatScroll(initial, "chat-1", 0);
    const loaded = reconcileInitialChatScroll(empty.state, "chat-1", 20);
    const appended = reconcileInitialChatScroll(loaded.state, "chat-1", 21);

    expect(empty.shouldScrollToEnd).toBe(false);
    expect(empty.state.pending).toBe(true);
    expect(loaded.shouldScrollToEnd).toBe(true);
    expect(loaded.state.pending).toBe(false);
    expect(appended.shouldScrollToEnd).toBe(false);
  });

  test("forces a latest-position reset when chats have the same row count", () => {
    const current: InitialChatScrollState = {
      chatId: "chat-1",
      pending: false,
    };
    const switched = reconcileInitialChatScroll(current, "chat-2", 20);

    expect(switched.chatChanged).toBe(true);
    expect(switched.shouldScrollToEnd).toBe(true);
    expect(switched.state).toEqual({
      chatId: "chat-2",
      pending: false,
    });
  });
});

describe("chat tail replacement following", () => {
  const thinkingTail: ChatVirtualTail = {
    itemCount: 2,
    key: "chat:chat-1:thinking",
  };
  const assistantTail: ChatVirtualTail = {
    itemCount: 2,
    key: "chat:chat-1:message:assistant-1",
  };

  test("follows a count-neutral thinking-to-assistant replacement when pinned", () => {
    expect(
      shouldFollowChatTailReplacement(thinkingTail, assistantTail, true, false)
    ).toBe(true);
  });

  test("does not pull a history reader to a replaced tail", () => {
    expect(
      shouldFollowChatTailReplacement(thinkingTail, assistantTail, false, false)
    ).toBe(false);
  });

  test("leaves appends and chat switches to their dedicated scroll paths", () => {
    expect(
      shouldFollowChatTailReplacement(
        thinkingTail,
        { ...assistantTail, itemCount: 3 },
        true,
        false
      )
    ).toBe(false);
    expect(
      shouldFollowChatTailReplacement(thinkingTail, assistantTail, true, true)
    ).toBe(false);
  });
});
