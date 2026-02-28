import { describe, expect, test } from "bun:test";
import type { UIMessage } from "../ui-message";
import { applySessionState, processSessionEvent } from "./use-chat-core";
import type { BroadcastEvent } from "./types";

function createAssistantMessage(
  id: string,
  parts: UIMessage["parts"]
): UIMessage {
  return {
    id,
    role: "assistant",
    parts,
  };
}

function createUserMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function applyEventWithMessages(
  event: BroadcastEvent,
  initialMessages: UIMessage[]
): UIMessage[] {
  const ordered = [...initialMessages];
  const byId = new Map(ordered.map((message) => [message.id, message]));

  processSessionEvent(
    event,
    { currentModes: null, currentModels: null },
    {
      getMessageById: (messageId) => byId.get(messageId),
      getMessagesForPermission: () => ordered,
      onMessageUpsert: (nextMessage) => {
        const index = ordered.findIndex((message) => message.id === nextMessage.id);
        if (index >= 0) {
          ordered[index] = nextMessage;
        } else {
          ordered.push(nextMessage);
        }
        byId.set(nextMessage.id, nextMessage);
      },
    }
  );

  return ordered;
}

describe("processSessionEvent ui_message_delta", () => {
  test("applies text delta to the existing assistant message", () => {
    const initialMessage = createAssistantMessage("msg-1", [
      { type: "text", text: "Hello", state: "streaming" },
    ]);
    const event: BroadcastEvent = {
      type: "ui_message_delta",
      messageId: "msg-1",
      partIndex: 0,
      delta: " world",
    };

    const next = applyEventWithMessages(event, [initialMessage]);
    expect(next).toHaveLength(1);
    expect(next[0]?.parts[0]).toEqual({
      type: "text",
      text: "Hello world",
      state: "streaming",
    });
  });

  test("applies reasoning delta to the indexed reasoning part", () => {
    const initialMessage = createAssistantMessage("msg-1", [
      { type: "reasoning", text: "Step 1", state: "streaming" },
      { type: "text", text: "Answer", state: "streaming" },
      { type: "reasoning", text: " / Step 2", state: "streaming" },
    ]);
    const event: BroadcastEvent = {
      type: "ui_message_delta",
      messageId: "msg-1",
      partIndex: 0,
      delta: " / Step 3",
    };

    const next = applyEventWithMessages(event, [initialMessage]);
    expect(next).toHaveLength(1);
    expect(next[0]?.parts[0]).toEqual({
      type: "reasoning",
      text: "Step 1 / Step 3",
      state: "streaming",
    });
    expect(next[0]?.parts[2]).toEqual({
      type: "reasoning",
      text: " / Step 2",
      state: "streaming",
    });
  });

  test("treats missing base text as empty string when applying delta", () => {
    const malformedMessage = createAssistantMessage("msg-1", [
      {
        type: "text",
        state: "streaming",
      } as unknown as UIMessage["parts"][number],
    ]);
    const event: BroadcastEvent = {
      type: "ui_message_delta",
      messageId: "msg-1",
      partIndex: 0,
      delta: "hello",
    };

    const next = applyEventWithMessages(event, [malformedMessage]);
    expect(next[0]?.parts[0]).toEqual({
      type: "text",
      text: "hello",
      state: "streaming",
    });
  });

  test("ignores delta updates when target message is missing", () => {
    const currentMessages: UIMessage[] = [];
    const event: BroadcastEvent = {
      type: "ui_message_delta",
      messageId: "missing",
      partIndex: 0,
      delta: "x",
    };

    const next = applyEventWithMessages(event, currentMessages);
    expect(next).toEqual([]);
  });

  test("ignores delta updates when target part index is invalid", () => {
    const currentMessages: UIMessage[] = [
      createAssistantMessage("msg-1", [{ type: "text", text: "a", state: "streaming" }]),
    ];
    const event: BroadcastEvent = {
      type: "ui_message_delta",
      messageId: "msg-1",
      partIndex: 5,
      delta: "x",
    };
    const next = applyEventWithMessages(event, currentMessages);
    expect(next[0]?.parts[0]).toEqual({
      type: "text",
      text: "a",
      state: "streaming",
    });
  });
});

describe("processSessionEvent ui_message_part", () => {
  test("adds a new assistant part when isNew is true", () => {
    const initialMessage = createAssistantMessage("msg-1", [
      { type: "text", text: "Answer", state: "streaming" },
    ]);
    const event: BroadcastEvent = {
      type: "ui_message_part",
      messageId: "msg-1",
      messageRole: "assistant",
      partIndex: 1,
      part: { type: "reasoning", text: "Done thinking", state: "done" },
      isNew: true,
    };

    const next = applyEventWithMessages(event, [initialMessage]);
    expect(next).toHaveLength(1);
    expect(next[0]?.parts).toEqual([
      { type: "text", text: "Answer", state: "streaming" },
      { type: "reasoning", text: "Done thinking", state: "done" },
    ]);
  });

  test("replaces an existing assistant part when isNew is false", () => {
    const initialMessage = createAssistantMessage("msg-1", [
      { type: "text", text: "Answer", state: "streaming" },
    ]);
    const event: BroadcastEvent = {
      type: "ui_message_part",
      messageId: "msg-1",
      messageRole: "assistant",
      partIndex: 0,
      part: { type: "text", text: "Answer", state: "done" },
      isNew: false,
    };

    const next = applyEventWithMessages(event, [initialMessage]);
    expect(next).toHaveLength(1);
    expect(next[0]?.parts).toEqual([
      { type: "text", text: "Answer", state: "done" },
    ]);
  });

  test("creates a missing message from a new part event", () => {
    const event: BroadcastEvent = {
      type: "ui_message_part",
      messageId: "msg-new",
      messageRole: "assistant",
      partIndex: 0,
      part: { type: "text", text: "Hello", state: "streaming" },
      isNew: true,
    };

    const next = applyEventWithMessages(event, []);
    expect(next).toEqual([
      {
        id: "msg-new",
        role: "assistant",
        parts: [{ type: "text", text: "Hello", state: "streaming" }],
      },
    ]);
  });
});

describe("processSessionEvent config/session-info updates", () => {
  test("maps inactive chat_status to idle connection state", () => {
    const connStates: string[] = [];
    const chatStates: string[] = [];

    processSessionEvent(
      {
        type: "chat_status",
        status: "inactive",
      },
      { currentModes: null, currentModels: null },
      {
        onConnStatusChange: (status) => {
          connStates.push(status);
        },
        onStatusChange: (status) => {
          chatStates.push(status);
        },
      }
    );

    expect(chatStates).toEqual(["inactive"]);
    expect(connStates).toEqual(["idle"]);
  });

  test("keeps non-inactive chat_status as connected connection state", () => {
    const connStates: string[] = [];
    const chatStates: string[] = [];

    processSessionEvent(
      {
        type: "chat_status",
        status: "streaming",
      },
      { currentModes: null, currentModels: null },
      {
        onConnStatusChange: (status) => {
          connStates.push(status);
        },
        onStatusChange: (status) => {
          chatStates.push(status);
        },
      }
    );

    expect(chatStates).toEqual(["streaming"]);
    expect(connStates).toEqual(["connected"]);
  });

  test("forwards config options updates", () => {
    const configOptions = [
      {
        id: "mode",
        name: "Mode",
        type: "select" as const,
        currentValue: "code",
        options: [{ value: "code", name: "Code" }],
      },
    ];
    const event: BroadcastEvent = {
      type: "config_options_update",
      configOptions,
    };
    const received: typeof configOptions[] = [];
    processSessionEvent(event, { currentModes: null, currentModels: null }, {
      onConfigOptionsChange: (options) => {
        received.push(options);
      },
    });
    expect(received).toEqual([configOptions]);
  });

  test("applies session info from session state snapshot", () => {
    let info: { title?: string | null; updatedAt?: string | null } | null = null;
    const connected = applySessionState(
      {
        status: "running",
        sessionInfo: { title: "Agent title" },
      },
      {
        onSessionInfoChange: (nextInfo) => {
          info = nextInfo;
        },
      }
    );
    expect(connected).toBe(true);
    expect(info).toEqual({ title: "Agent title" });
  });

  test("skips command callback when session state commands are unchanged", () => {
    const currentCommands = [
      {
        name: "read_file",
        description: "Read file",
        input: { hint: "path" },
      },
    ];
    const received: typeof currentCommands[] = [];

    applySessionState(
      {
        status: "running",
        commands: [
          {
            name: "read_file",
            description: "Read file",
            input: { hint: "path" },
          },
        ],
      },
      {
        getCommands: () => currentCommands,
        onCommandsChange: (next) => {
          received.push(next);
        },
      }
    );

    expect(received).toEqual([]);
  });

  test("applies current model update to existing model state", () => {
    let nextModels:
      | {
          currentModelId: string;
          availableModels: Array<{ modelId: string; name: string }>;
        }
      | null = null;
    processSessionEvent(
      {
        type: "current_model_update",
        modelId: "model-2",
      },
      {
        currentModes: null,
        currentModels: {
          currentModelId: "model-1",
          availableModels: [
            { modelId: "model-1", name: "Model 1" },
            { modelId: "model-2", name: "Model 2" },
          ],
        },
      },
      {
        onModelsChange: (models) => {
          nextModels = models;
        },
      }
    );
    expect(nextModels).toEqual({
      currentModelId: "model-2",
      availableModels: [
        { modelId: "model-1", name: "Model 1" },
        { modelId: "model-2", name: "Model 2" },
      ],
    });
  });

  test("finalizes streaming assistant parts when chat_finish arrives", () => {
    const finishMessage = createAssistantMessage("msg-finish", [
      { type: "reasoning", text: "thinking", state: "streaming" },
      {
        type: "tool-edit",
        toolCallId: "tool-1",
        title: "Edit",
        state: "input-available",
        input: { path: "index.ts" },
      },
      { type: "text", text: "done", state: "streaming" },
    ]);

    let upserted: UIMessage | null = null;
    let finished: {
      messageId?: string;
      message?: UIMessage;
    } | null = null;

    processSessionEvent(
      {
        type: "chat_finish",
        stopReason: "end_turn",
        finishReason: "stop",
        messageId: "msg-finish",
        isAbort: false,
      },
      { currentModes: null, currentModels: null },
      {
        getMessageById: () => finishMessage,
        onMessageUpsert: (message) => {
          upserted = message;
        },
        onFinish: (payload) => {
          finished = {
            messageId: payload.messageId,
            message: payload.message,
          };
        },
      }
    );

    expect(upserted).not.toBeNull();
    expect(upserted?.parts[0]).toEqual({
      type: "reasoning",
      text: "thinking",
      state: "done",
    });
    expect(upserted?.parts[1]).toEqual({
      type: "tool-edit",
      toolCallId: "tool-1",
      title: "Edit",
      state: "output-available",
      input: { path: "index.ts" },
      output: null,
      preliminary: true,
    });
    expect(upserted?.parts[2]).toEqual({
      type: "text",
      text: "done",
      state: "done",
    });
    expect(finished?.messageId).toBe("msg-finish");
    expect(finished?.message?.parts[2]).toEqual({
      type: "text",
      text: "done",
      state: "done",
    });
  });

  test("finalizes latest streaming assistant when chat_finish has no message reference", () => {
    const olderAssistant = createAssistantMessage("msg-old", [
      { type: "text", text: "old", state: "done" },
    ]);
    const streamingAssistant = createAssistantMessage("msg-live", [
      { type: "text", text: "live", state: "streaming" },
    ]);
    const messages = [olderAssistant, createUserMessage("user-1", "question"), streamingAssistant];

    const next = applyEventWithMessages(
      {
        type: "chat_finish",
        stopReason: "end_turn",
        finishReason: "stop",
        isAbort: false,
      },
      messages
    );

    const finalized = next.find((message) => message.id === "msg-live");
    expect(finalized?.parts[0]).toEqual({
      type: "text",
      text: "live",
      state: "done",
    });
  });
});

describe("processSessionEvent available_commands_update", () => {
  test("skips callback when commands are semantically unchanged", () => {
    const currentCommands = [
      {
        name: "read_file",
        description: "Read file",
        input: { hint: "path" },
      },
    ];
    const received: typeof currentCommands[] = [];

    processSessionEvent(
      {
        type: "available_commands_update",
        availableCommands: [
          {
            name: "read_file",
            description: "Read file",
            input: { hint: "path" },
          },
        ],
      },
      { currentModes: null, currentModels: null },
      {
        getCommands: () => currentCommands,
        onCommandsChange: (next) => {
          received.push(next);
        },
      }
    );

    expect(received).toEqual([]);
  });

  test("forwards callback when command payload changes", () => {
    const currentCommands = [
      {
        name: "read_file",
        description: "Read file",
        input: { hint: "path" },
      },
    ];
    const received: typeof currentCommands[] = [];

    processSessionEvent(
      {
        type: "available_commands_update",
        availableCommands: [
          {
            name: "read_file",
            description: "Read file",
            input: { hint: "new-path" },
          },
        ],
      },
      { currentModes: null, currentModels: null },
      {
        getCommands: () => currentCommands,
        onCommandsChange: (next) => {
          received.push(next);
        },
      }
    );

    expect(received).toEqual([
      [
        {
          name: "read_file",
          description: "Read file",
          input: { hint: "new-path" },
        },
      ],
    ]);
  });
});

describe("processSessionEvent file_modified", () => {
  test("forwards file path to callback", () => {
    const received: string[] = [];
    processSessionEvent(
      {
        type: "file_modified",
        path: "src/new-file.ts",
      },
      { currentModes: null, currentModels: null },
      {
        onFileModified: (filePath) => {
          received.push(filePath);
        },
      }
    );
    expect(received).toEqual(["src/new-file.ts"]);
  });
});
