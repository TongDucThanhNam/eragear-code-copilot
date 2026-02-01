import { useCallback, useEffect, useRef } from "react";

import { useAuthConfigured } from "@/hooks/use-auth-config";
import { buildSendMessagePayload, type Attachment } from "@/lib/attachments";
import { trpc } from "@/lib/trpc";
import {
  type PermissionRequest,
  type ToolCall,
  useChatStore,
} from "@/store/chat-store";

// Helper for random IDs
const nanoid = () => Math.random().toString(36).substring(2, 10);

// Session event types (matching server's BroadcastEvent)
type SessionEvent =
  | { type: "connected" }
  | { type: "current_mode_update"; modeId: string }
  | { type: "plan_update"; plan: Plan }
  | { type: "session_update"; update?: SessionUpdate }
  | {
      type: "request_permission";
      requestId: string;
      toolCall: unknown;
      options?: unknown;
    }
  | { type: "user_message"; id: string; text: string; timestamp: number }
  | { type: "message"; message: unknown }
  | { type: "heartbeat"; ts: number }
  | { type: "error"; error: string }
  | { type: "terminal_output"; terminalId: string; data: string };

type Plan = {
  entries: Array<{ content: string; status: string }>;
};

// Session update types (matching ACP protocol)
type SessionUpdate =
  | {
      sessionUpdate: "user_message_chunk";
      content: unknown;
      text?: string;
    }
  | {
      sessionUpdate: "agent_message_chunk";
      content: unknown;
      text?: string;
    }
  | {
      sessionUpdate: "agent_thought_chunk";
      content: unknown;
      text?: string;
    }
  | {
      sessionUpdate: "tool_call";
      toolCallId: string;
      title?: string;
      kind?: string;
      rawInput?: unknown;
    }
  | {
      sessionUpdate: "tool_call_update";
      toolCallId: string;
      content?: unknown;
      status?: string;
      rawOutput?: unknown;
    }
  | {
      sessionUpdate: "plan";
      entries: Array<{ title?: string; text?: string; status: string }>;
    }
  | {
      sessionUpdate: "available_commands_update";
      availableCommands: unknown[];
    }
  | {
      sessionUpdate: "current_mode_update";
      currentModeId: string;
    }
  | { sessionUpdate: "turn_end" }
  | { sessionUpdate: "prompt_end" }
  | { sessionUpdate: string; [key: string]: unknown };

// Helper to extract text from content
function extractTextFromContent(
  content: unknown,
  fallbackText?: string
): string {
  if (typeof content === "string") {
    return content;
  }
  if (typeof content === "object" && content !== null) {
    return (
      (content as { text?: string }).text ||
      (content as { delta?: { text?: string } }).delta?.text ||
      ""
    );
  }
  return fallbackText || "";
}

// Helper to convert content to tool_result content format (matching ACP protocol)
type ToolResultContentItem = {
  type: string;
  text?: string;
  source?: {
    type: string;
    text?: string;
    oldText?: string;
    path?: string;
  };
};

function parseContentToToolResultContent(
  content: unknown
): ToolResultContentItem[] {
  if (!content) {
    return [];
  }

  // If content is already an array
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "object" && item !== null) {
        const typedItem = item as {
          type?: string;
          text?: string;
          output?: string;
          source?: {
            type?: string;
            text?: string;
            oldText?: string;
            path?: string;
          };
        };
        // Check for 'output' field (used by tool calls)
        if (typedItem.output) {
          return {
            type: "text" as const,
            text: typedItem.output,
          };
        }
        return {
          type: typedItem.type || "text",
          text: typedItem.text,
          source: typedItem.source
            ? {
                type: typedItem.source.type || "diff",
                text: typedItem.source.text,
                oldText: typedItem.source.oldText,
                path: typedItem.source.path,
              }
            : undefined,
        };
      }
      return { type: "text", text: String(item) };
    });
  }

  // If content is a single object with type/content
  if (typeof content === "object" && content !== null) {
    const typedContent = content as {
      type?: string;
      content?: unknown;
      text?: string;
      output?: string;
      source?: unknown;
    };

    // Handle rawOutput structure with output field
    if (typedContent.output) {
      return [{ type: "text", text: typedContent.output }];
    }

    if (typedContent.type === "content" && typedContent.content) {
      return parseContentToToolResultContent(typedContent.content);
    }
    return [
      {
        type: typedContent.type || "text",
        text: typedContent.text,
      },
    ];
  }

  // Fallback to string
  return [{ type: "text", text: String(content) }];
}

export function useChat() {
  // Select only what we need for the hook's internal logic (subscription key)
  const activeChatId = useChatStore((s) => s.activeChatId);
  const activeChatIsReadOnly = useChatStore((s) => s.activeChatIsReadOnly);
  const connStatus = useChatStore((s) => s.connStatus);
  const isConfigured = useAuthConfigured();

  const utils = trpc.useUtils();
  const lastStreamKindRef = useRef<"user" | "agent" | "other" | null>(null);

  // Mutations
  const stopSessionMutation = trpc.stopSession.useMutation();
  const resumeSessionMutation = trpc.resumeSession.useMutation();
  const sendMessageMutation = trpc.sendMessage.useMutation();
  const setModeMutation = trpc.setMode.useMutation();
  const setModelMutation = trpc.setModel.useMutation();
  const cancelPromptMutation = trpc.cancelPrompt.useMutation();
  const respondToPermissionMutation =
    trpc.respondToPermissionRequest.useMutation();

  // Snapshot state (modes/models/commands) on connect or reconnect
  const sessionStateQuery = trpc.getSessionState.useQuery(
    { chatId: activeChatId || "" },
    {
      enabled:
        isConfigured &&
        !!activeChatId &&
        !activeChatIsReadOnly &&
        connStatus === "connecting",
      retry: false,
    }
  );

  const applyPlanEntries = useCallback(
    (
      entries: Array<{ content: string; status: string }>,
      store: ReturnType<typeof useChatStore.getState>
    ) => {
      if (!entries.length) {
        return;
      }
      store.flushPending();
      const planPart = {
        type: "plan" as const,
        items: entries.map((entry) => ({
          content: entry.content,
          status: entry.status,
        })),
      };
      const lastMsg = store.messages.at(-1);

      if (lastMsg?.role === "assistant") {
        const lastPart = lastMsg.parts.at(-1);
        if (lastPart?.type === "plan") {
          const newParts = [...lastMsg.parts];
          newParts[newParts.length - 1] = planPart;
          store.updateLastAssistantMessage(newParts);
        } else {
          store.updateLastAssistantMessage([...lastMsg.parts, planPart]);
        }
      } else {
        store.addMessage({
          id: nanoid(),
          role: "assistant",
          parts: [planPart],
          timestamp: Date.now(),
        });
      }
    },
    []
  );

  const applySessionState = useCallback(
    (data: NonNullable<typeof sessionStateQuery.data>) => {
      const store = useChatStore.getState();
      if (data.status === "stopped") {
        store.setPromptCapabilities(null);
        store.setConnStatus("idle");
        return;
      }

      if (data.modes) {
        store.setModes(data.modes);
      }
      if (data.models) {
        store.setModels(data.models);
      }
      if (data.commands) {
        const commands = (data.commands || []).map((cmd) => ({
          name: cmd.name,
          description: cmd.description,
          input: cmd.input === null ? undefined : cmd.input,
        }));
        store.setCommands(commands);
      }
      if (data.promptCapabilities !== undefined) {
        store.setPromptCapabilities(data.promptCapabilities);
      }
      if (data.plan?.entries?.length) {
        applyPlanEntries(
          data.plan.entries.map((entry) => ({
            content: entry.content,
            status: entry.status,
          })),
          store
        );
      }
      store.setConnStatus("connected");
    },
    [applyPlanEntries]
  );

  useEffect(() => {
    const data = sessionStateQuery.data;
    if (!data || connStatus !== "connecting") {
      return;
    }

    applySessionState(data);
  }, [sessionStateQuery.data, connStatus, applySessionState]);

  // Individual session update handlers
  const handleUserMessageChunk = useCallback(
    (
      update: SessionUpdate,
      store: ReturnType<typeof useChatStore.getState>
    ) => {
      const userUpdate = update as {
        sessionUpdate: "user_message_chunk";
        content: unknown;
        text?: string;
      };
      const text = extractTextFromContent(userUpdate.content, userUpdate.text);
      if (!text) {
        return;
      }

      if (lastStreamKindRef.current === "user") {
        store.appendToUserText(text);
      } else {
        store.addMessage({
          id: nanoid(),
          role: "user",
          parts: [{ type: "text", text }],
          timestamp: Date.now(),
        });
      }
      lastStreamKindRef.current = "user";
    },
    []
  );

  const handleAgentMessageChunk = useCallback(
    (
      update: SessionUpdate,
      store: ReturnType<typeof useChatStore.getState>
    ) => {
      const agentUpdate = update as {
        sessionUpdate: "agent_message_chunk";
        content: unknown;
        text?: string;
      };
      const text = extractTextFromContent(
        agentUpdate.content,
        agentUpdate.text
      );
      if (!text) {
        return;
      }

      store.appendToText(text);
      lastStreamKindRef.current = "agent";
    },
    []
  );

  const handleAgentThoughtChunk = useCallback(
    (
      update: SessionUpdate,
      store: ReturnType<typeof useChatStore.getState>
    ) => {
      const thoughtUpdate = update as {
        sessionUpdate: "agent_thought_chunk";
        content: unknown;
        text?: string;
      };
      const text = extractTextFromContent(
        thoughtUpdate.content,
        thoughtUpdate.text
      );
      if (!text) {
        return;
      }

      store.appendToReasoning(text);
      lastStreamKindRef.current = "agent";
    },
    []
  );

  const handleToolCall = useCallback(
    (
      update: SessionUpdate,
      store: ReturnType<typeof useChatStore.getState>
    ) => {
      const toolUpdate = update as {
        sessionUpdate: "tool_call";
        toolCallId: string;
        title?: string;
        kind?: string;
        rawInput?: unknown;
      };
      store.flushPending();
      lastStreamKindRef.current = "other";

      const lastMsg = store.messages.at(-1);
      if (lastMsg?.role === "assistant") {
        const newParts = [
          ...lastMsg.parts,
          {
            type: "tool_call" as const,
            toolCallId: toolUpdate.toolCallId,
            name: toolUpdate.title || toolUpdate.kind || "Tool",
            args: toolUpdate.rawInput,
          },
        ];
        store.updateLastAssistantMessage(newParts);
      }
    },
    []
  );

  const handleToolCallUpdate = useCallback(
    (
      update: SessionUpdate,
      store: ReturnType<typeof useChatStore.getState>
    ) => {
      const toolUpdate = update as {
        sessionUpdate: "tool_call_update";
        toolCallId: string;
        content?: unknown;
        status?: string;
        rawOutput?: unknown;
      };
      const lastMsg = store.messages.at(-1);
      if (lastMsg?.role !== "assistant") {
        return;
      }

      const parts = [...lastMsg.parts];
      const status = toolUpdate.status ?? "completed";
      const normalizedStatus = status.toLowerCase();
      const isTerminal =
        normalizedStatus === "completed" ||
        normalizedStatus === "failed" ||
        normalizedStatus === "error";

      if (!isTerminal) {
        return;
      }

      const inputContent = toolUpdate.content ?? toolUpdate.rawOutput;
      const contentArray = parseContentToToolResultContent(inputContent);
      const resultPart = {
        type: "tool_result" as const,
        toolCallId: toolUpdate.toolCallId,
        status,
        content: contentArray,
      };

      const existingResultIndex = parts.findIndex(
        (part) =>
          part.type === "tool_result" &&
          part.toolCallId === toolUpdate.toolCallId
      );
      if (existingResultIndex >= 0) {
        parts[existingResultIndex] = resultPart;
        store.updateLastAssistantMessage(parts);
        return;
      }

      const toolCallIndex = parts.findIndex(
        (part) =>
          part.type === "tool_call" &&
          part.toolCallId === toolUpdate.toolCallId
      );
      if (toolCallIndex >= 0) {
        parts.splice(toolCallIndex + 1, 0, resultPart);
      } else {
        parts.push(resultPart);
      }
      store.updateLastAssistantMessage(parts);
    },
    []
  );

  const handlePlanUpdate = useCallback(
    (
      update: SessionUpdate,
      store: ReturnType<typeof useChatStore.getState>
    ) => {
      const planUpdate = update as {
        sessionUpdate: "plan";
        entries: Array<{ title?: string; text?: string; status: string }>;
      };
      applyPlanEntries(
        planUpdate.entries.map((entry) => ({
          content: entry.title || entry.text || "",
          status: entry.status,
        })),
        store
      );
    },
    [applyPlanEntries]
  );

  const handleAvailableCommandsUpdate = useCallback(
    (
      update: SessionUpdate,
      store: ReturnType<typeof useChatStore.getState>
    ) => {
      const cmdUpdate = update as {
        sessionUpdate: "available_commands_update";
        availableCommands: Array<{
          name: string;
          description: string;
          input?: { hint: string } | null;
        }>;
      };
      const commands = (cmdUpdate.availableCommands || []).map((cmd) => {
        const input = cmd.input;
        return {
          name: cmd.name,
          description: cmd.description,
          input: input === null ? undefined : input,
        } as { name: string; description: string; input?: { hint: string } };
      });
      store.setCommands(commands);
    },
    []
  );

  // Main session update handler
  const handleSessionUpdate = useCallback(
    (
      update: SessionUpdate,
      store: ReturnType<typeof useChatStore.getState>
    ) => {
      switch (update.sessionUpdate) {
        case "user_message_chunk":
          handleUserMessageChunk(update, store);
          break;
        case "agent_message_chunk":
          handleAgentMessageChunk(update, store);
          break;
        case "agent_thought_chunk":
          handleAgentThoughtChunk(update, store);
          break;
        case "tool_call":
          handleToolCall(update, store);
          break;
        case "tool_call_update":
          handleToolCallUpdate(update, store);
          break;
        case "plan":
          handlePlanUpdate(update, store);
          break;
        case "available_commands_update":
          handleAvailableCommandsUpdate(update, store);
          break;
        default:
          break;
      }
    },
    [
      handleUserMessageChunk,
      handleAgentMessageChunk,
      handleAgentThoughtChunk,
      handleToolCall,
      handleToolCallUpdate,
      handlePlanUpdate,
      handleAvailableCommandsUpdate,
    ]
  );

  // Subscription Handler
  const handleSessionEvent = useCallback(
    (event: SessionEvent) => {
      const store = useChatStore.getState();

      switch (event.type) {
        case "connected":
          store.setConnStatus("connected");
          break;

        case "user_message":
          store.addMessage({
            id: event.id || nanoid(),
            role: "user",
            parts: [{ type: "text", text: event.text }],
            timestamp: event.timestamp || Date.now(),
          });
          lastStreamKindRef.current = "other";
          break;

        case "plan_update":
          applyPlanEntries(
            event.plan.entries.map((entry) => ({
              content: entry.content,
              status: entry.status,
            })),
            store
          );
          break;

        case "session_update":
          if (event.update) {
            handleSessionUpdate(event.update, store);
          }
          break;

        case "current_mode_update": {
          const modes = store.modes;
          if (modes) {
            store.setModes({ ...modes, currentModeId: event.modeId });
          }
          break;
        }

        case "request_permission": {
          store.setPendingPermission({
            requestId: event.requestId,
            toolCall: event.toolCall as ToolCall,
            options: event.options as PermissionRequest["options"],
          });
          break;
        }

        case "terminal_output": {
          const { terminalId, data } = event;
          if (terminalId && data) {
            store.appendTerminalOutput(terminalId, data);
          }
          break;
        }

        case "error":
          store.setError(event.error);
          break;

        default:
          break;
      }
    },
    [applyPlanEntries, handleSessionUpdate]
  );

  // Check if this chat has already failed (prevents infinite loop)
  const isChatFailed = useChatStore((s) => s.isChatFailed);
  const shouldSubscribe =
    !!activeChatId &&
    !activeChatIsReadOnly &&
    !isChatFailed(activeChatId) &&
    connStatus === "connected" &&
    isConfigured;

  // Subscription
  trpc.onSessionEvents.useSubscription(
    { chatId: activeChatId || "" },
    {
      enabled: shouldSubscribe,
      onData: (data) => handleSessionEvent(data as SessionEvent),
      onError(err) {
        console.error("Subscription error:", err);
        const store = useChatStore.getState();
        const message =
          typeof err?.message === "string" ? err.message : "Subscription error";

        if (message.includes("Chat not found") && activeChatId) {
          // Mark this chat as failed to prevent infinite re-subscription
          store.markChatFailed(activeChatId);
          store.setActiveChatId(null);
          store.setConnStatus("idle");
          store.setError(
            "Chat not found. The session may have expired. Please start a new session."
          );
          return;
        }

        store.setConnStatus("error");
        store.setError(message);
      },
    }
  );

  const sendMessage = async (text: string, attachments: Attachment[] = []) => {
    if (!activeChatId) {
      return false;
    }
    const store = useChatStore.getState();

    // Note: We don't add message here. Server will broadcast user_message event
    // which will be received via subscription and added to store.
    // This ensures consistency between live and replayed messages.

    try {
      const payload = buildSendMessagePayload(text, attachments);
      await sendMessageMutation.mutateAsync({
        chatId: activeChatId,
        ...payload,
      });
      return true;
    } catch (e) {
      const error = e as Error;
      store.setError(error.message);
      return false;
    }
  };

  const setMode = async (modeId: string) => {
    if (!activeChatId) {
      return;
    }
    const store = useChatStore.getState();
    try {
      await setModeMutation.mutateAsync({ chatId: activeChatId, modeId });
      if (store.modes) {
        store.setModes({ ...store.modes, currentModeId: modeId });
      }
    } catch (e) {
      const error = e as Error;
      store.setError(error.message);
    }
  };

  const setModel = async (modelId: string) => {
    if (!activeChatId) {
      return;
    }
    const store = useChatStore.getState();
    try {
      await setModelMutation.mutateAsync({ chatId: activeChatId, modelId });
      if (store.models) {
        store.setModels({ ...store.models, currentModelId: modelId });
      }
    } catch (e) {
      const error = e as Error;
      const message = error?.message || "Failed to set model";
      const normalized = message.toLowerCase();
      if (
        normalized.includes("model switching") ||
        normalized.includes("method not found")
      ) {
        store.setModels(null);
      }
      store.setError(message);
    }
  };

  const cancelPrompt = async () => {
    if (!activeChatId) {
      return;
    }
    const store = useChatStore.getState();
    try {
      await cancelPromptMutation.mutateAsync({ chatId: activeChatId });
    } catch (e) {
      const error = e as Error;
      store.setError(error.message);
    }
  };

  const respondToPermission = async (requestId: string, decision: string) => {
    if (!activeChatId) {
      return;
    }
    const store = useChatStore.getState();
    try {
      await respondToPermissionMutation.mutateAsync({
        chatId: activeChatId,
        requestId,
        decision,
      });
      store.setPendingPermission(null);
    } catch (e) {
      const error = e as Error;
      store.setError(error.message);
    }
  };

  const stopSession = async () => {
    if (!activeChatId) {
      return;
    }
    await stopSessionMutation.mutateAsync({ chatId: activeChatId });
    useChatStore.getState().setConnStatus("idle");
  };

  const resumeSession = async (chatId: string) => {
    const store = useChatStore.getState();
    try {
      store.setConnStatus("connecting");
      const res = await resumeSessionMutation.mutateAsync({ chatId });
      const state = await utils.getSessionState.fetch({ chatId });
      applySessionState(state);
      if (res?.promptCapabilities !== undefined) {
        store.setPromptCapabilities(res.promptCapabilities);
      }
      return res;
    } catch (e) {
      const error = e as Error;
      store.setError(error.message);
      store.setConnStatus("error");
      throw e;
    }
  };

  return {
    sendMessage,
    setMode,
    setModel,
    cancelPrompt,
    respondToPermission,
    stopSession,
    resumeSession,
    isResuming: resumeSessionMutation.isPending,
    isSending: sendMessageMutation.isPending,
    isCancelling: cancelPromptMutation.isPending,
  };
}
