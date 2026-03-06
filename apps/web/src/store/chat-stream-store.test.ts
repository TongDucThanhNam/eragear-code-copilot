import { beforeEach, describe, expect, test } from "bun:test";
import type { UIMessage } from "@repo/shared";
import {
  applyPartUpdate,
  replaceMessagesState,
} from "@/hooks/use-chat-message-state";
import {
  CHAT_TERMINAL_OUTPUT_MAX_CHARS,
  readCombinedTerminalOutput,
  TERMINAL_OUTPUT_MAX_CHARS,
  useChatStreamStore,
} from "./chat-stream-store";

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

  test("updateMessageState keeps terminal buffer reference stable", () => {
    useChatStreamStore
      .getState()
      .appendTerminalOutput(CHAT_ID, "term-1", "log line");
    const beforeTerminalBuffers = useChatStreamStore.getState().byChatId[
      CHAT_ID
    ]?.terminalBuffers;

    useChatStreamStore.getState().updateMessageState(CHAT_ID, (prev) =>
      replaceMessagesState([
        ...prev.orderedMessages,
        createAssistantMessage("msg-2", "next"),
      ])
    );

    const afterTerminalBuffers = useChatStreamStore.getState().byChatId[
      CHAT_ID
    ]?.terminalBuffers;
    expect(afterTerminalBuffers).toBe(beforeTerminalBuffers);
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

  test("updateMessageState preserves message order reference for part-only updates", () => {
    const store = useChatStreamStore.getState();
    store.updateMessageState(CHAT_ID, () =>
      replaceMessagesState([createAssistantMessage("msg-1", "hello")])
    );

    const beforeOrder = useChatStreamStore
      .getState()
      .getMessageState(CHAT_ID).order;

    store.updateMessageState(CHAT_ID, (prev) =>
      applyPartUpdate(prev, {
        messageId: "msg-1",
        messageRole: "assistant",
        partIndex: 0,
        part: { type: "text", text: "hello world", state: "done" },
        isNew: false,
      })
    );

    const afterState = useChatStreamStore.getState().getMessageState(CHAT_ID);
    expect(afterState.order).toBe(beforeOrder);
    expect(afterState.byId.get("msg-1")?.parts[0]).toEqual({
      type: "text",
      text: "hello world",
      state: "done",
    });
  });

  test("appendTerminalOutput publishes a new terminal output reference", () => {
    const terminalOutputSizes: number[] = [];
    const unsubscribe = useChatStreamStore.subscribe((nextState, prevState) => {
      const nextOutputs = nextState.byChatId[CHAT_ID]?.terminalBuffers;
      const prevOutputs = prevState.byChatId[CHAT_ID]?.terminalBuffers;
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

  test("readCombinedTerminalOutput returns only the selected terminal ids", () => {
    const store = useChatStreamStore.getState();
    store.appendTerminalOutput(CHAT_ID, "term-1", "stdout");
    store.appendTerminalOutput(CHAT_ID, "term-2", "stderr");
    store.appendTerminalOutput(CHAT_ID, "term-3", "ignored");

    expect(
      readCombinedTerminalOutput(
        useChatStreamStore.getState().byChatId[CHAT_ID]?.terminalBuffers ?? {},
        ["term-1", "term-2"]
      )
    ).toBe("stdoutstderr");
  });

  test("appendTerminalOutput caps each terminal buffer to the latest max chars", () => {
    const store = useChatStreamStore.getState();
    const oversizedChunk = "a".repeat(TERMINAL_OUTPUT_MAX_CHARS + 1024);

    store.appendTerminalOutput(CHAT_ID, "term-1", oversizedChunk);

    const terminalBuffer =
      useChatStreamStore.getState().byChatId[CHAT_ID]?.terminalBuffers["term-1"];
    const output = readCombinedTerminalOutput(
      useChatStreamStore.getState().byChatId[CHAT_ID]?.terminalBuffers ?? {},
      ["term-1"]
    );
    expect(output.length).toBe(TERMINAL_OUTPUT_MAX_CHARS);
    expect(output).toBe(oversizedChunk.slice(-TERMINAL_OUTPUT_MAX_CHARS));
    expect(terminalBuffer?.startOffset ?? 0).toBe(1024);
  });

  test("appendTerminalOutput prunes oldest terminal buffers when chat budget is exceeded", () => {
    const store = useChatStreamStore.getState();
    const terminalChunk = "x".repeat(300 * 1024);

    for (let index = 1; index <= 5; index += 1) {
      store.appendTerminalOutput(CHAT_ID, `term-${index}`, terminalChunk);
    }

    const snapshot = useChatStreamStore.getState().byChatId[CHAT_ID];
    const terminalIds = Object.keys(snapshot?.terminalBuffers ?? {});

    expect(snapshot?.terminalTotalChars ?? 0).toBeLessThanOrEqual(
      CHAT_TERMINAL_OUTPUT_MAX_CHARS
    );
    expect(terminalIds.includes("term-1")).toBe(false);
    expect(terminalIds.includes("term-5")).toBe(true);
  });

  test("appendTerminalOutput withstands 50k packets while staying within bounds", () => {
    const store = useChatStreamStore.getState();

    for (let index = 0; index < 50_000; index += 1) {
      store.appendTerminalOutput(CHAT_ID, "term-1", `${index % 10}`);
    }

    const terminalBuffer =
      useChatStreamStore.getState().byChatId[CHAT_ID]?.terminalBuffers["term-1"];
    const output = readCombinedTerminalOutput(
      useChatStreamStore.getState().byChatId[CHAT_ID]?.terminalBuffers ?? {},
      ["term-1"]
    );

    expect(terminalBuffer?.totalChars ?? 0).toBeLessThanOrEqual(
      TERMINAL_OUTPUT_MAX_CHARS
    );
    expect(output.length).toBe(50_000);
    expect(output.endsWith("9")).toBe(true);
  });
});
