import { beforeEach, describe, expect, test } from "bun:test";
import type { UIMessage } from "@repo/shared";
import { replaceMessagesState } from "@/hooks/use-chat-message-state";
import { useChatStreamStore } from "./chat-stream-store";

const CHAT_ID = "chat-1";
const CHAT_ID_2 = "chat-2";

function createAssistantMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text, state: "done" }],
  };
}

describe("chat-stream-store", () => {
  beforeEach(() => {
    useChatStreamStore.setState({ byChatId: {} });
  });

  test("appendTerminalOutput keeps messageState reference stable", () => {
    const store = useChatStreamStore.getState();
    const initialMessageState = replaceMessagesState([
      createAssistantMessage("msg-1", "hello"),
    ]);
    store.updateMessageState(CHAT_ID, () => initialMessageState);

    const beforeMessageState = useChatStreamStore
      .getState()
      .getMessageState(CHAT_ID);
    useChatStreamStore.getState().appendTerminalOutput(CHAT_ID, "term-1", "log");
    const afterMessageState = useChatStreamStore
      .getState()
      .getMessageState(CHAT_ID);

    expect(afterMessageState).toBe(beforeMessageState);
  });

  test("updateMessageState keeps terminalOutputs reference stable", () => {
    useChatStreamStore
      .getState()
      .setTerminalOutputs(CHAT_ID, { "term-1": "log line" });
    const beforeTerminalOutputs = useChatStreamStore
      .getState()
      .getTerminalOutputs(CHAT_ID);

    useChatStreamStore.getState().updateMessageState(CHAT_ID, (prev) =>
      replaceMessagesState([
        ...prev.orderedMessages,
        createAssistantMessage("msg-2", "next"),
      ])
    );

    const afterTerminalOutputs = useChatStreamStore
      .getState()
      .getTerminalOutputs(CHAT_ID);
    expect(afterTerminalOutputs).toBe(beforeTerminalOutputs);
  });

  test("clearChat removes only the target chat snapshot", () => {
    const store = useChatStreamStore.getState();
    store.updateMessageState(CHAT_ID, () =>
      replaceMessagesState([createAssistantMessage("msg-1", "chat-1")])
    );
    store.updateMessageState(CHAT_ID_2, () =>
      replaceMessagesState([createAssistantMessage("msg-2", "chat-2")])
    );

    store.clearChat(CHAT_ID);

    const first = useChatStreamStore.getState().getMessageState(CHAT_ID);
    const second = useChatStreamStore.getState().getMessageState(CHAT_ID_2);
    expect(first.order).toEqual([]);
    expect(second.orderedMessages).toEqual([
      createAssistantMessage("msg-2", "chat-2"),
    ]);
  });

  test("updateMessageState publishes a new orderedMessages reference", () => {
    const orderedMessageLengths: number[] = [];
    const unsubscribe = useChatStreamStore.subscribe((nextState, prevState) => {
      const nextMessages =
        nextState.byChatId[CHAT_ID]?.messageState.orderedMessages;
      const prevMessages =
        prevState.byChatId[CHAT_ID]?.messageState.orderedMessages;
      if (nextMessages && nextMessages !== prevMessages) {
        orderedMessageLengths.push(nextMessages.length);
      }
    });

    const store = useChatStreamStore.getState();
    store.updateMessageState(CHAT_ID, () =>
      replaceMessagesState([createAssistantMessage("msg-1", "first")])
    );
    store.appendTerminalOutput(CHAT_ID, "term-1", "log");
    store.updateMessageState(CHAT_ID, (prev) =>
      replaceMessagesState([
        ...prev.orderedMessages,
        createAssistantMessage("msg-2", "second"),
      ])
    );
    unsubscribe();

    expect(orderedMessageLengths).toEqual([1, 2]);
  });

  test("appendTerminalOutput publishes a new terminal output reference", () => {
    const terminalOutputSizes: number[] = [];
    const unsubscribe = useChatStreamStore.subscribe((nextState, prevState) => {
      const nextOutputs = nextState.byChatId[CHAT_ID]?.terminalOutputs;
      const prevOutputs = prevState.byChatId[CHAT_ID]?.terminalOutputs;
      if (nextOutputs && nextOutputs !== prevOutputs) {
        terminalOutputSizes.push(Object.keys(nextOutputs).length);
      }
    });

    const store = useChatStreamStore.getState();
    store.appendTerminalOutput(CHAT_ID, "term-1", "line 1");
    store.updateMessageState(CHAT_ID, () =>
      replaceMessagesState([createAssistantMessage("msg-1", "hello")])
    );
    store.appendTerminalOutput(CHAT_ID, "term-2", "line 2");
    unsubscribe();

    expect(terminalOutputSizes).toEqual([1, 2]);
  });

  test("evicts least-recently-touched chat snapshots beyond LRU cap", () => {
    const store = useChatStreamStore.getState();
    for (let index = 1; index <= 22; index += 1) {
      store.updateMessageState(`chat-${index}`, () =>
        replaceMessagesState([
          createAssistantMessage(`msg-${index}`, `chat-${index}`),
        ])
      );
    }

    const chatIds = Object.keys(useChatStreamStore.getState().byChatId);
    expect(chatIds).toHaveLength(20);
    expect(chatIds.includes("chat-1")).toBe(false);
    expect(chatIds.includes("chat-2")).toBe(false);
    expect(chatIds.includes("chat-22")).toBe(true);
  });
});
