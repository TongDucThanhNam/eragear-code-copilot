import { describe, expect, test } from "bun:test";
import type { UIMessage } from "../ui-message";
import type { BroadcastEvent } from "./types";
import {
  applySessionState,
  findPendingPermission,
  processSessionEvent,
} from "./use-chat-core";

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
        const index = ordered.findIndex(
          (message) => message.id === nextMessage.id
        );
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

  test("propagates ui_message_part partId to part payload for stable rendering keys", () => {
    const initialMessage = createAssistantMessage("msg-1", [
      { type: "text", text: "Answer", state: "streaming" },
    ]);
    const event: BroadcastEvent = {
      type: "ui_message_part",
      messageId: "msg-1",
      messageRole: "assistant",
      partId: "part-msg1-0",
      partIndex: 0,
      part: { type: "text", text: "Answer", state: "done" },
      isNew: false,
    };

    const next = applyEventWithMessages(event, [initialMessage]);
    const updatedPart = next[0]?.parts[0];
    expect(updatedPart).toEqual({
      type: "text",
      text: "Answer",
      state: "done",
      id: "part-msg1-0",
    });
  });

  test("recovers out-of-bounds non-new text update when partId is present", () => {
    const initialMessage = createAssistantMessage("msg-1", [
      { type: "reasoning", text: "thinking", state: "done", id: "part-r0" },
      {
        type: "tool-edit",
        toolCallId: "tool-1",
        title: "Edit",
        state: "output-available",
        input: { path: "index.ts" },
      },
    ]);
    const event: BroadcastEvent = {
      type: "ui_message_part",
      messageId: "msg-1",
      messageRole: "assistant",
      partId: "part-text-tail",
      partIndex: 16,
      part: { type: "text", text: "tail", state: "streaming" },
      isNew: false,
    };

    const next = applyEventWithMessages(event, [initialMessage]);
    expect(next).toHaveLength(1);
    expect(next[0]?.parts).toHaveLength(3);
    expect(next[0]?.parts[2]).toEqual({
      type: "text",
      text: "tail",
      state: "streaming",
      id: "part-text-tail",
    });
  });

  test("keeps dropping out-of-bounds non-new text update without partId", () => {
    const initialMessage = createAssistantMessage("msg-1", [
      { type: "text", text: "Answer", state: "done" },
    ]);
    const event: BroadcastEvent = {
      type: "ui_message_part",
      messageId: "msg-1",
      messageRole: "assistant",
      partIndex: 16,
      part: { type: "text", text: "tail", state: "streaming" },
      isNew: false,
    };

    const next = applyEventWithMessages(event, [initialMessage]);
    expect(next).toEqual([initialMessage]);
  });

  test("removes a part by stable identity when ui_message_part_removed arrives", () => {
    const initialMessage = createAssistantMessage("msg-1", [
      { type: "text", text: "Lead", state: "done", id: "part-lead" },
      {
        type: "data-tool-locations",
        id: "tool-locations:tool-1",
        data: {
          toolCallId: "tool-1",
          locations: [{ path: "src/example.ts", line: 1 }],
        },
      },
      { type: "text", text: "Tail", state: "done", id: "part-tail" },
    ]);
    const event: BroadcastEvent = {
      type: "ui_message_part_removed",
      messageId: "msg-1",
      messageRole: "assistant",
      partId: "tool-locations:tool-1",
      partIndex: 1,
      part: {
        type: "data-tool-locations",
        data: {
          toolCallId: "tool-1",
          locations: [{ path: "src/example.ts", line: 1 }],
        },
      },
    };

    const next = applyEventWithMessages(event, [initialMessage]);
    expect(next[0]?.parts).toEqual([
      { type: "text", text: "Lead", state: "done", id: "part-lead" },
      { type: "text", text: "Tail", state: "done", id: "part-tail" },
    ]);
  });
});

describe("findPendingPermission", () => {
  test("prefers the latest approval-requested tool part", () => {
    const olderPending = createAssistantMessage("msg-older", [
      {
        type: "tool-bash",
        toolCallId: "tool-old",
        title: "Old request",
        state: "approval-requested",
        approval: { id: "req-old" },
      },
    ]);
    const latestPending = createAssistantMessage("msg-latest", [
      {
        type: "tool-bash",
        toolCallId: "tool-new",
        title: "New request",
        state: "approval-requested",
        approval: { id: "req-new" },
      },
    ]);

    expect(findPendingPermission([olderPending, latestPending])).toEqual({
      requestId: "req-new",
      toolCallId: "tool-new",
      title: "New request",
      input: undefined,
      options: undefined,
    });
  });
});

describe("processSessionEvent config/session-info updates", () => {
  test("keeps connection state in sync across repeated connect/disconnect cycles", () => {
    const connStates: string[] = [];
    const chatStates: string[] = [];
    const cycleEvents: BroadcastEvent[] = [
      { type: "chat_status", status: "ready" },
      { type: "chat_status", status: "inactive" },
      { type: "chat_status", status: "ready" },
      { type: "chat_status", status: "inactive" },
      { type: "chat_status", status: "ready" },
      { type: "chat_status", status: "inactive" },
    ];

    for (const event of cycleEvents) {
      processSessionEvent(
        event,
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
    }

    expect(chatStates).toEqual([
      "ready",
      "inactive",
      "ready",
      "inactive",
      "ready",
      "inactive",
    ]);
    expect(connStates).toEqual([
      "connected",
      "idle",
      "connected",
      "idle",
      "connected",
      "idle",
    ]);
  });

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
    const received: (typeof configOptions)[] = [];
    processSessionEvent(
      event,
      { currentModes: null, currentModels: null },
      {
        onConfigOptionsChange: (options) => {
          received.push(options);
        },
      }
    );
    expect(received).toEqual([configOptions]);
  });

  test("derives mode and model state from config options updates", () => {
    let nextModes: unknown = null;
    let nextModels: unknown = null;

    processSessionEvent(
      {
        type: "config_options_update",
        configOptions: [
          {
            id: "mode",
            name: "Mode",
            category: "mode",
            type: "select",
            currentValue: "code",
            options: [
              { value: "ask", name: "Ask" },
              { value: "code", name: "Code" },
            ],
          },
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "model-2",
            options: [
              { value: "model-1", name: "Model 1" },
              { value: "model-2", name: "Model 2" },
            ],
          },
        ],
      },
      {
        currentModes: {
          currentModeId: "legacy",
          availableModes: [{ id: "legacy", name: "Legacy" }],
        },
        currentModels: {
          currentModelId: "legacy-model",
          availableModels: [{ modelId: "legacy-model", name: "Legacy Model" }],
        },
      },
      {
        onModesChange: (modes) => {
          nextModes = modes;
        },
        onModelsChange: (models) => {
          nextModels = models;
        },
      }
    );

    expect(nextModes).toEqual({
      currentModeId: "code",
      availableModes: [
        { id: "ask", name: "Ask", description: undefined },
        { id: "code", name: "Code", description: undefined },
      ],
    });
    expect(nextModels).toEqual({
      currentModelId: "model-2",
      availableModels: [
        { modelId: "model-1", name: "Model 1", description: undefined },
        { modelId: "model-2", name: "Model 2", description: undefined },
      ],
    });
  });

  test("applies session info from session state snapshot", () => {
    let info: { title?: string | null; updatedAt?: string | null } | null =
      null;
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

  test("prefers config options over legacy session selection snapshot", () => {
    let nextModes: unknown = null;
    let nextModels: unknown = null;

    applySessionState(
      {
        status: "running",
        modes: {
          currentModeId: "legacy",
          availableModes: [{ id: "legacy", name: "Legacy" }],
        },
        models: {
          currentModelId: "legacy-model",
          availableModels: [{ modelId: "legacy-model", name: "Legacy Model" }],
        },
        configOptions: [
          {
            id: "mode",
            name: "Mode",
            category: "mode",
            type: "select",
            currentValue: "code",
            options: [{ value: "code", name: "Code" }],
          },
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "model-2",
            options: [{ value: "model-2", name: "Model 2" }],
          },
        ],
      },
      {
        onModesChange: (modes) => {
          nextModes = modes;
        },
        onModelsChange: (models) => {
          nextModels = models;
        },
      }
    );

    expect(nextModes).toEqual({
      currentModeId: "code",
      availableModes: [{ id: "code", name: "Code", description: undefined }],
    });
    expect(nextModels).toEqual({
      currentModelId: "model-2",
      availableModels: [
        { modelId: "model-2", name: "Model 2", description: undefined },
      ],
    });
  });

  test("skips command callback when session state commands are unchanged", () => {
    const currentCommands = [
      {
        name: "read_file",
        description: "Read file",
        input: { hint: "path" },
      },
    ];
    const received: (typeof currentCommands)[] = [];

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
    let nextModels: {
      currentModelId: string;
      availableModels: Array<{ modelId: string; name: string }>;
    } | null = null;
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

  test("updates matching config options on current selection events", () => {
    const currentConfigOptions = [
      {
        id: "mode",
        name: "Mode",
        category: "mode" as const,
        type: "select" as const,
        currentValue: "ask",
        options: [
          { value: "ask", name: "Ask" },
          { value: "code", name: "Code" },
        ],
      },
      {
        id: "model",
        name: "Model",
        category: "model" as const,
        type: "select" as const,
        currentValue: "model-1",
        options: [
          { value: "model-1", name: "Model 1" },
          { value: "model-2", name: "Model 2" },
        ],
      },
    ];
    const configSnapshots: (typeof currentConfigOptions)[] = [];
    let nextModes: unknown = null;
    let nextModels: unknown = null;

    processSessionEvent(
      {
        type: "current_mode_update",
        modeId: "code",
      },
      {
        currentModes: {
          currentModeId: "ask",
          availableModes: [{ id: "ask", name: "Ask" }],
        },
        currentModels: null,
        currentConfigOptions,
      },
      {
        onConfigOptionsChange: (configOptions) => {
          configSnapshots.push(configOptions);
        },
        onModesChange: (modes) => {
          nextModes = modes;
        },
      }
    );

    processSessionEvent(
      {
        type: "current_model_update",
        modelId: "model-2",
      },
      {
        currentModes: null,
        currentModels: {
          currentModelId: "model-1",
          availableModels: [{ modelId: "model-1", name: "Model 1" }],
        },
        currentConfigOptions: configSnapshots[0] ?? currentConfigOptions,
      },
      {
        onConfigOptionsChange: (configOptions) => {
          configSnapshots.push(configOptions);
        },
        onModelsChange: (models) => {
          nextModels = models;
        },
      }
    );

    expect(configSnapshots).toEqual([
      [
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          type: "select",
          currentValue: "code",
          options: [
            { value: "ask", name: "Ask" },
            { value: "code", name: "Code" },
          ],
        },
        currentConfigOptions[1],
      ],
      [
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          type: "select",
          currentValue: "code",
          options: [
            { value: "ask", name: "Ask" },
            { value: "code", name: "Code" },
          ],
        },
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "model-2",
          options: [
            { value: "model-1", name: "Model 1" },
            { value: "model-2", name: "Model 2" },
          ],
        },
      ],
    ]);
    expect(nextModes).toEqual({
      currentModeId: "code",
      availableModes: [
        { id: "ask", name: "Ask", description: undefined },
        { id: "code", name: "Code", description: undefined },
      ],
    });
    expect(nextModels).toEqual({
      currentModelId: "model-2",
      availableModels: [
        { modelId: "model-1", name: "Model 1", description: undefined },
        { modelId: "model-2", name: "Model 2", description: undefined },
      ],
    });
  });

  test("hydrates mode state from current_mode_update when mode state is missing", () => {
    let nextModes: {
      currentModeId: string;
      availableModes: Array<{ id: string; name: string }>;
    } | null = null;

    processSessionEvent(
      {
        type: "current_mode_update",
        modeId: "code",
      },
      { currentModes: null, currentModels: null },
      {
        onModesChange: (modes) => {
          nextModes = modes;
        },
      }
    );

    expect(nextModes).toEqual({
      currentModeId: "code",
      availableModes: [],
    });
  });

  test("hydrates model state from current_model_update when model state is missing", () => {
    let nextModels: {
      currentModelId: string;
      availableModels: Array<{ modelId: string; name: string }>;
    } | null = null;

    processSessionEvent(
      {
        type: "current_model_update",
        modelId: "model-x",
      },
      { currentModes: null, currentModels: null },
      {
        onModelsChange: (models) => {
          nextModels = models;
        },
      }
    );

    expect(nextModels).toEqual({
      currentModelId: "model-x",
      availableModels: [],
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
    const messages = [
      olderAssistant,
      createUserMessage("user-1", "question"),
      streamingAssistant,
    ];

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

  test("marks unfinished tool parts as cancelled when chat_finish stopReason is cancelled", () => {
    const finishMessage = createAssistantMessage("msg-cancelled", [
      {
        type: "tool-bash",
        toolCallId: "tool-1",
        title: "Run",
        state: "approval-requested",
        input: { cmd: "ls" },
        approval: { id: "req-1" },
      },
      {
        type: "tool-edit",
        toolCallId: "tool-2",
        title: "Edit",
        state: "approval-responded",
        input: { path: "index.ts" },
        approval: { id: "req-2", approved: true, reason: "allow_once" },
      },
    ]);

    let upserted: UIMessage | null = null;

    processSessionEvent(
      {
        type: "chat_finish",
        stopReason: "cancelled",
        finishReason: "other",
        messageId: "msg-cancelled",
        isAbort: true,
      },
      { currentModes: null, currentModels: null },
      {
        getMessageById: () => finishMessage,
        onMessageUpsert: (message) => {
          upserted = message;
        },
      }
    );

    expect(upserted?.parts).toEqual([
      {
        type: "tool-bash",
        toolCallId: "tool-1",
        title: "Run",
        state: "output-cancelled",
        input: { cmd: "ls" },
        approval: {
          id: "req-1",
          approved: false,
          reason: "cancelled",
        },
      },
      {
        type: "tool-edit",
        toolCallId: "tool-2",
        title: "Edit",
        state: "output-cancelled",
        input: { path: "index.ts" },
        approval: { id: "req-2", approved: true, reason: "allow_once" },
      },
    ]);
  });

  test("does not coerce chat status to ready when chat_finish arrives", () => {
    const chatStates: string[] = [];

    processSessionEvent(
      {
        type: "chat_finish",
        stopReason: "end_turn",
        finishReason: "stop",
        isAbort: false,
      },
      { currentModes: null, currentModels: null },
      {
        onStatusChange: (status) => {
          chatStates.push(status);
        },
      }
    );

    expect(chatStates).toEqual([]);
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
    const received: (typeof currentCommands)[] = [];

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
    const received: (typeof currentCommands)[] = [];

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
