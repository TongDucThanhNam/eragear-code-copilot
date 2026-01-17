import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanStatus } from "@/components/ai-elements/plan";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { ChatHeader } from "@/components/chat-ui/chat-header";
import { ChatInput } from "@/components/chat-ui/chat-input";
import {
  ChatMessages,
  type MessageType,
  type ToolPart,
} from "@/components/chat-ui/chat-messages";
import { SettingsDialog } from "@/components/settings-dialog";
import { trpc } from "@/lib/trpc";
import { useDiffStore } from "@/store/diff-store";
import { useFileStore } from "@/store/file-store";
import { useSettingsStore } from "@/store/settings-store";

const convertFileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

interface ChatInterfaceProps {
  initialChatId?: string | null;
  onChatIdChange?: (chatId: string | null) => void;
}

export function ChatInterface({
  initialChatId,
  onChatIdChange,
}: ChatInterfaceProps) {
  const { setIsOpen, getAgents, activeAgentId, setActiveAgentId } =
    useSettingsStore();

  const agentModels = getAgents();
  const utils = trpc.useUtils();

  const [status, setStatus] = useState<
    "submitted" | "streaming" | "ready" | "error"
  >("ready");
  const [chatId, setChatId] = useState<string | null>(initialChatId || null);
  const [connStatus, setConnStatus] = useState<
    "idle" | "connecting" | "connected" | "error"
  >(initialChatId ? "connecting" : "idle");
  const [currentModeId, setCurrentModeId] = useState<string | null>(null);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);

  const [availableModes, setAvailableModes] = useState<
    { id: string; name: string; description?: string }[]
  >([]);
  const [availableModels, setAvailableModels] = useState<
    { modelId: string; name: string; description?: string }[]
  >([]);
  const [availableCommands, setAvailableCommands] = useState<
    { name: string; description: string; input?: { hint: string } }[]
  >([]);
  const [_promptCapabilities, setPromptCapabilities] = useState<{
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  }>({});

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatIdRef = useRef<string | null>(initialChatId || null);
  const lastStreamKindRef = useRef<"user" | "agent" | "other" | null>(null);

  const [terminalOutputs, setTerminalOutputs] = useState<
    Record<string, string>
  >({});

  const [messages, setMessages] = useState<MessageType[]>([]);

  const updateMessagesState = useCallback(
    (updater: (old: MessageType[]) => MessageType[]) => {
      setMessages((prev) => updater(prev));
    },
    []
  );

  useEffect(() => {
    if (initialChatId && initialChatId !== chatId) {
      console.log(
        "[ChatInterface] Reconnecting to chat from prop:",
        initialChatId
      );
      setChatId(initialChatId);
      chatIdRef.current = initialChatId;
      setConnStatus("connecting");
    } else if (!initialChatId && chatId) {
      // If prop cleared but we have local state
    }
  }, [initialChatId, chatId]);

  const createSessionMutation = trpc.createSession.useMutation();
  const sendMessageMutation = trpc.sendMessage.useMutation();
  const stopSessionMutation = trpc.stopSession.useMutation();
  const setModeMutation = trpc.setMode.useMutation();
  const setModelMutation = trpc.setModel.useMutation();
  const resumeSessionMutation = trpc.resumeSession.useMutation();
  const cancelPromptMutation = trpc.cancelPrompt.useMutation();
  const permissionResponseMutation =
    trpc.respondToPermissionRequest.useMutation();

  const { data: sessionState } = trpc.getSessionState.useQuery(
    { chatId: chatId || "" },
    {
      enabled: !!chatId && connStatus === "connecting",
      retry: false,
    }
  );

  const restoreSessionState = useCallback(
    (state: NonNullable<typeof sessionState>) => {
      if (state.modes) {
        setAvailableModes(
          state.modes.availableModes.map((m) => ({
            ...m,
            description: m.description || undefined,
          }))
        );
        setCurrentModeId(state.modes.currentModeId || null);
      }
      if (state.models) {
        setAvailableModels(
          state.models.availableModels.map((m) => ({
            modelId: m.modelId,
            name: m.name,
            description: m.description || undefined,
          }))
        );
        setCurrentModelId(state.models.currentModelId || null);
      }
      if (state.commands) {
        setAvailableCommands(
          state.commands.map((c) => ({
            name: c.name,
            description: c.description,
            input: c.input ?? undefined,
          }))
        );
      }
      if (state.promptCapabilities) {
        setPromptCapabilities(state.promptCapabilities);
      }
    },
    []
  );

  useEffect(() => {
    if (sessionState && connStatus === "connecting") {
      console.log("[Client] Session state restored:", sessionState);

      if (sessionState.status === "stopped") {
        console.log("[Client] Session is stopped");
        setConnStatus("idle");
        return;
      }

      restoreSessionState(sessionState);
      setConnStatus("connected");
    }
  }, [sessionState, connStatus, restoreSessionState]);

  const extractToolContentInfo = useCallback(
    (
      content:
        | Array<{
            type: string;
            terminalId?: string;
            path?: string;
            oldText?: string;
            newText?: string;
          }>
        | undefined
    ): {
      terminalId: string | undefined;
      diffs: Array<{ path: string; oldText?: string; newText: string }>;
    } => {
      if (!(content && Array.isArray(content))) {
        return { terminalId: undefined, diffs: [] };
      }

      const terminalId = content.find(
        (c): c is { type: "terminal"; terminalId: string } =>
          c.type === "terminal"
      )?.terminalId;

      const diffParts = content.filter(
        (
          c
        ): c is {
          type: "diff";
          path: string;
          oldText?: string;
          newText: string;
        } => c.type === "diff"
      );
      const diffs = diffParts.map((d) => ({
        path: d.path,
        oldText: d.oldText,
        newText: d.newText,
      }));

      if (diffs.length > 0) {
        const addDiff = useDiffStore.getState().addDiff;
        diffs.forEach(addDiff);
      }

      return { terminalId, diffs };
    },
    []
  );

  const handleAgentToolCall = useCallback(
    (tool: ToolCallContent) => {
      updateMessagesState((prev) => {
        const lastMsg = prev.at(-1);
        if (!lastMsg || lastMsg.from !== "assistant") {
          return prev;
        }

        const { terminalId, diffs } = extractToolContentInfo(tool.content);

        const newTool: ToolPart = {
          type: "tool",
          toolCallId: tool.toolCallId,
          name: tool.title || tool.kind || "Tool",
          description: tool.kind || "",
          status: (tool.status || "pending") as
            | "pending"
            | "approval-requested"
            | "running"
            | "completed"
            | "error",
          parameters: tool.rawInput || {},
          result: undefined,
          error: undefined,
          terminalId,
          diffs,
        };

        const parts = [...lastMsg.parts, newTool];
        return [...prev.slice(0, -1), { ...lastMsg, parts }];
      });
    },
    [updateMessagesState, extractToolContentInfo]
  );

  const updateToolFromContent = useCallback(
    (
      tool: ToolPart,
      content:
        | Array<{
            type: string;
            content?: { text: string };
            terminalId?: string;
            path?: string;
            oldText?: string;
            newText?: string;
          }>
        | undefined
    ): ToolPart => {
      if (!(content && Array.isArray(content))) {
        return tool;
      }

      tool.result = content.map((c) => c.content?.text || "").join("\n");

      const { terminalId, diffs } = extractToolContentInfo(content);
      if (terminalId) {
        tool.terminalId = terminalId;
      }
      if (diffs.length > 0) {
        tool.diffs = diffs;
      }

      return tool;
    },
    [extractToolContentInfo]
  );

  const handleAgentToolCallUpdate = useCallback(
    (update: ToolCallUpdateContent) => {
      updateMessagesState((prev) => {
        const lastMsg = prev.at(-1);
        if (!lastMsg || lastMsg.from !== "assistant") {
          return prev;
        }

        const parts = [...lastMsg.parts];
        const partIndex = parts.findIndex(
          (p): p is ToolPart =>
            p.type === "tool" && p.toolCallId === update.toolCallId
        );

        if (partIndex === -1) {
          return prev;
        }

        let tool = { ...parts[partIndex] } as ToolPart;

        if (update.status) {
          tool.status = update.status as
            | "pending"
            | "approval-requested"
            | "running"
            | "completed"
            | "error";
        }

        tool = updateToolFromContent(tool, update.content);

        parts[partIndex] = tool;
        return [...prev.slice(0, -1), { ...lastMsg, parts }];
      });
    },
    [updateMessagesState, updateToolFromContent]
  );

  const handleAgentPlan = useCallback(
    (entries: Array<{ id: string; content: string; status: string }>) => {
      const typedEntries: Array<{ content: string; status: PlanStatus }> =
        entries.map((e) => ({
          content: e.content,
          status: e.status as PlanStatus,
        }));

      updateMessagesState((prev) => {
        const lastMsg = prev.at(-1);
        if (lastMsg && lastMsg.from === "assistant") {
          const parts = [...lastMsg.parts];
          const lastPart = parts.at(-1);
          if (lastPart && lastPart.type === "plan") {
            parts[parts.length - 1] = { ...lastPart, entries: typedEntries };
          } else {
            parts.push({ type: "plan", entries: typedEntries });
          }
          return [...prev.slice(0, -1), { ...lastMsg, parts }];
        }
        const newMsg: MessageType = {
          key: nanoid(),
          from: "assistant",
          parts: [{ type: "plan", entries: typedEntries }],
        };
        return [...prev, newMsg];
      });
    },
    [updateMessagesState]
  );

  const handlePermissionRequest = useCallback(
    (
      requestId: string,
      toolCall: { toolCallId: string },
      options?: unknown[]
    ) => {
      updateMessagesState((prev) => {
        const lastMsg = prev.at(-1);
        if (!lastMsg || lastMsg.from !== "assistant") {
          return prev;
        }

        const parts = [...lastMsg.parts];
        const partIndex = parts.findIndex(
          (p): p is ToolPart =>
            p.type === "tool" && p.toolCallId === toolCall.toolCallId
        );

        if (partIndex !== -1) {
          parts[partIndex] = {
            ...parts[partIndex],
            status: "approval-requested" as const,
            requestId,
            options,
          } as ToolPart;
          return [...prev.slice(0, -1), { ...lastMsg, parts }];
        }
        return prev;
      });
    },
    [updateMessagesState]
  );

  const handleApproveTool = useCallback(
    (requestId: string, decision = "allow") => {
      if (!chatId) {
        return;
      }
      permissionResponseMutation.mutate({
        chatId,
        requestId,
        decision,
      });
    },
    [chatId, permissionResponseMutation]
  );

  const handleRejectTool = useCallback(
    (requestId: string, decision = "reject") => {
      if (!chatId) {
        return;
      }
      permissionResponseMutation.mutate({
        chatId,
        requestId,
        decision,
      });
    },
    [chatId, permissionResponseMutation]
  );

  const handleAgentChunk = useCallback(
    (chunk: string) => {
      updateMessagesState((prev) => {
        const lastMsg = prev.at(-1);
        if (lastMsg && lastMsg.from === "assistant") {
          const parts = [...lastMsg.parts];
          const lastPart = parts.at(-1);
          if (lastPart && lastPart.type === "text") {
            const newContent = lastPart.content + chunk;
            parts[parts.length - 1] = { ...lastPart, content: newContent };
          } else {
            parts.push({ type: "text", content: chunk });
          }
          return [...prev.slice(0, -1), { ...lastMsg, parts }];
        }
        const newMsg: MessageType = {
          key: nanoid(),
          from: "assistant",
          parts: [{ type: "text", content: chunk }],
        };
        return [...prev, newMsg];
      });
      setStatus("streaming");
    },
    [updateMessagesState]
  );

  const handleAgentThought = useCallback(
    (chunk: string) => {
      updateMessagesState((prev) => {
        const lastMsg = prev.at(-1);
        if (lastMsg && lastMsg.from === "assistant") {
          const currentReasoning = lastMsg.reasoning?.content || "";
          const newReasoning = currentReasoning + chunk;
          const newLastMsg = {
            ...lastMsg,
            reasoning: {
              content: newReasoning,
              duration: lastMsg.reasoning?.duration || 0,
            },
          };
          return [...prev.slice(0, -1), newLastMsg];
        }
        const newMsg: MessageType = {
          key: nanoid(),
          from: "assistant",
          parts: [],
          reasoning: {
            content: chunk,
            duration: 0,
          },
        };
        return [...prev, newMsg];
      });
      setStatus("streaming");
    },
    [updateMessagesState]
  );

  const extractTextFromContent = useCallback(
    (content: unknown, fallbackText?: string): string => {
      if (typeof content === "string") {
        return content;
      }
      if (typeof content === "object" && content !== null) {
        const obj = content as Record<string, unknown>;
        const text = obj.text as string | undefined;
        if (text) {
          return text;
        }
        const delta = obj.delta as Record<string, unknown> | undefined;
        if (delta?.text && typeof delta.text === "string") {
          return delta.text;
        }
        const value = obj.value as string | undefined;
        if (value) {
          return value;
        }
        return fallbackText || "";
      }
      return fallbackText || "";
    },
    []
  );

  interface UserMessageEvent {
    type: "user_message";
    id: string;
    text: string;
    timestamp: number;
  }

  interface SessionUpdateEvent {
    sessionUpdate:
      | "user_message_chunk"
      | "agent_message_chunk"
      | "agent_thought_chunk"
      | "tool_call"
      | "tool_call_update"
      | "available_commands_update"
      | "plan";
    content?: unknown;
    text?: string;
    toolCallId?: string;
    title?: string;
    kind?: string;
    rawInput?: Record<string, unknown>;
    status?: string;
    availableCommands?: Array<{
      name: string;
      description: string;
      input?: { hint: string } | null;
    }>;
    entries?: Array<{ id: string; content: string; status: string }>;
  }

  type BroadcastEvent =
    | { type: "connected" }
    | UserMessageEvent
    | { type: "session_update"; update: SessionUpdateEvent }
    | { type: "current_mode_update"; modeId: string }
    | {
        type: "request_permission";
        requestId: string;
        toolCall: { toolCallId: string };
        options?: unknown[];
      }
    | { type: "error"; error: string }
    | { type: "heartbeat"; ts: number }
    | { type: "terminal_output"; terminalId: string; data: string };

  const processSessionUpdate = useCallback(
    (u: SessionUpdateEvent) => {
      switch (u.sessionUpdate) {
        case "user_message_chunk": {
          const text = extractTextFromContent(u.content, u.text);
          if (!text) {
            return;
          }
          setMessages((prev) => {
            const lastMsg = prev.at(-1);
            if (
              lastStreamKindRef.current === "user" &&
              lastMsg &&
              lastMsg.from === "user"
            ) {
              const parts = [...lastMsg.parts];
              const lastPart = parts.at(-1);
              if (lastPart && lastPart.type === "text") {
                const newContent = lastPart.content + text;
                parts[parts.length - 1] = {
                  ...lastPart,
                  content: newContent,
                };
              } else {
                parts.push({ type: "text", content: text });
              }
              return [...prev.slice(0, -1), { ...lastMsg, parts }];
            }
            const newMsg: MessageType = {
              key: nanoid(),
              from: "user",
              parts: [{ type: "text", content: text }],
            };
            return [...prev, newMsg];
          });
          lastStreamKindRef.current = "user";
          return;
        }

        case "agent_message_chunk": {
          const text = extractTextFromContent(u.content, u.text);
          if (text) {
            handleAgentChunk(text);
            lastStreamKindRef.current = "agent";
          } else {
            console.warn("[Client] Could not extract text from chunk:", u);
          }
          return;
        }

        case "agent_thought_chunk": {
          const text = extractTextFromContent(u.content, u.text);
          if (text) {
            handleAgentThought(text);
            lastStreamKindRef.current = "agent";
          } else {
            console.warn("[Client] Could not extract thought from chunk:", u);
          }
          return;
        }

        case "tool_call":
          lastStreamKindRef.current = "other";
          handleAgentToolCall(u as unknown as ToolCallContent);
          return;

        case "tool_call_update":
          if (u.toolCallId) {
            handleAgentToolCallUpdate(u as ToolCallUpdateContent);
          }
          return;

        case "available_commands_update": {
          console.log(
            "[Client] Commands update:",
            JSON.stringify(u.availableCommands, null, 2)
          );
          if (u.availableCommands) {
            setAvailableCommands(
              u.availableCommands.map((c) => ({
                name: c.name,
                description: c.description,
                input: c.input ?? undefined,
              }))
            );
          }
          return;
        }

        case "plan":
          if (u.entries) {
            handleAgentPlan(u.entries);
          }
          return;

        default:
          return;
      }
    },
    [
      extractTextFromContent,
      handleAgentChunk,
      handleAgentThought,
      handleAgentToolCall,
      handleAgentToolCallUpdate,
      handleAgentPlan,
    ]
  );

  const processSessionEvent = useCallback(
    (event: BroadcastEvent) => {
      switch (event.type) {
        case "connected":
          console.log("[Client] Connection confirmed by server");
          return;

        case "user_message": {
          const exists = messages.some((m) => m.key === event.id);
          if (!exists) {
            setMessages((prev) => [
              ...prev,
              {
                key: event.id,
                from: "user" as const,
                parts: [{ type: "text", content: event.text }],
              },
            ]);
          }
          lastStreamKindRef.current = "other";
          return;
        }

        case "session_update": {
          const u = event.update;
          console.log(
            "[Client] Session Update Detail:",
            JSON.stringify(u, null, 2)
          );
          processSessionUpdate(u);
          return;
        }

        case "current_mode_update":
          setCurrentModeId(event.modeId);
          return;

        case "request_permission":
          console.log("[Client] Permission Request:", event);
          handlePermissionRequest(
            event.requestId,
            event.toolCall,
            event.options
          );
          return;

        case "error":
          console.error("tRPC Error Event:", event.error);
          setConnStatus("error");
          setMessages((prev) => [
            ...prev,
            {
              key: nanoid(),
              from: "assistant" as const,
              parts: [{ type: "text", content: `❌ Error: ${event.error}` }],
            },
          ]);
          return;

        case "heartbeat":
          console.log("[Client] Heartbeat", event.ts);
          return;

        case "terminal_output":
          if (event.terminalId && event.data) {
            setTerminalOutputs((prev) => ({
              ...prev,
              [event.terminalId]: (prev[event.terminalId] || "") + event.data,
            }));
          }
          return;

        default:
          return;
      }
    },
    [messages, handlePermissionRequest, processSessionUpdate]
  );

  trpc.onSessionEvents.useSubscription(
    { chatId: chatId || "" },
    {
      enabled: !!chatId && connStatus === "connected",
      onData(event: unknown) {
        console.log("[Client] tRPC Event:", event);
        processSessionEvent(event as BroadcastEvent);
      },
      onError(err) {
        console.error("[Client] Subscription error:", err);
        setConnStatus("error");
      },
    }
  );

  const initChat = useCallback(
    async (agentId?: string) => {
      const targetId = agentId || useSettingsStore.getState().activeAgentId;
      const agent = useSettingsStore
        .getState()
        .getAgents()
        .find((a) => a.id === targetId);

      if (!agent) {
        console.warn("No active agent selected");
        setConnStatus("idle");
        return;
      }

      setConnStatus("connecting");
      try {
        const data = await createSessionMutation.mutateAsync({
          projectRoot: ".",
          command: agent?.command,
          args: agent?.args,
          env: agent?.env,
          cwd: agent?.cwd,
        });

        setChatId(data.chatId);
        chatIdRef.current = data.chatId;

        if (onChatIdChange) {
          onChatIdChange(data.chatId);
        }

        if (data.modes) {
          setAvailableModes(
            data.modes.availableModes.map((m) => ({
              ...m,
              description: m.description || undefined,
            }))
          );
          setCurrentModeId(data.modes.currentModeId || null);
        }
        if (data.models) {
          setAvailableModels(
            data.models.availableModels.map((m) => ({
              modelId: m.modelId,
              name: m.name,
              description: m.description || undefined,
            }))
          );
          setCurrentModelId(data.models.currentModelId || null);
        }
        if (data.promptCapabilities) {
          setPromptCapabilities(data.promptCapabilities);
        }
        setConnStatus("connected");
      } catch (e) {
        console.error("Failed to init chat", e);
        setConnStatus("error");
      }
    },
    [createSessionMutation, onChatIdChange]
  );

  const handleNewChat = (agentId: string) => {
    setMessages([]);
    setChatId(null);
    chatIdRef.current = null;
    setTerminalOutputs({});
    useDiffStore.getState().clearDiffs();

    if (onChatIdChange) {
      onChatIdChange(null);
    }

    setActiveAgentId(agentId);
    initChat(agentId);
  };

  const handleStopChat = async () => {
    const targetChatId = chatIdRef.current;
    if (!targetChatId) {
      return;
    }
    try {
      await stopSessionMutation.mutateAsync({ chatId: targetChatId });
      setConnStatus("idle");
      setChatId(null);
      chatIdRef.current = null;

      if (onChatIdChange) {
        onChatIdChange(null);
      }

      setAvailableModes([]);
      setCurrentModeId(null);
      setAvailableModels([]);
      setCurrentModelId(null);
    } catch (e) {
      console.error("Failed to stop chat", e);
    }
  };

  const handleCancel = async () => {
    if (!chatId) {
      return;
    }
    try {
      await cancelPromptMutation.mutateAsync({ chatId });
    } catch (e) {
      console.error("Failed to cancel prompt", e);
    }
  };

  const handleResume = async () => {
    if (!chatId) {
      return;
    }
    try {
      await resumeSessionMutation.mutateAsync({ chatId });
      await utils.getSessionState.invalidate({ chatId });
      setConnStatus("connecting");
    } catch (e) {
      console.error("Failed to resume chat", e);
      setConnStatus("error");
    }
  };

  const handleSetMode = async (modeId: string) => {
    if (!chatId) {
      return;
    }
    try {
      await setModeMutation.mutateAsync({ chatId, modeId });
      setCurrentModeId(modeId);
    } catch (e) {
      console.error("Failed to set mode", e);
    }
  };

  const handleSetModel = async (modelId: string) => {
    if (!chatId) {
      return;
    }
    try {
      await setModelMutation.mutateAsync({ chatId, modelId });
      setCurrentModelId(modelId);
    } catch (e) {
      console.error("Failed to set model", e);
    }
  };

  const addUserMessage = useCallback(
    async (
      content: string,
      images?: { base64: string; mimeType: string }[]
    ) => {
      if (!chatId) {
        return;
      }

      setStatus("streaming");

      try {
        const res = await sendMessageMutation.mutateAsync({
          chatId,
          text: content,
          images,
        });

        if (res.stopReason === "cancelled") {
          updateMessagesState((prev) => [
            ...prev,
            {
              key: nanoid(),
              from: "assistant",
              parts: [{ type: "text", content: "🚫 Generation cancelled." }],
            },
          ]);
        } else if (res.stopReason === "max_tokens") {
          updateMessagesState((prev) => [
            ...prev,
            {
              key: nanoid(),
              from: "assistant",
              parts: [{ type: "text", content: "⚠️ Max tokens reached." }],
            },
          ]);
        }
      } catch (e) {
        console.error("Failed to send message", e);
        setConnStatus("error");
      } finally {
        setStatus("ready");
      }
    },
    [chatId, sendMessageMutation, updateMessagesState]
  );

  const handleSubmit = async (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasFiles = message.files.length > 0;
    if (!(hasText || hasFiles)) {
      return;
    }

    setStatus("submitted");

    const images: { base64: string; mimeType: string }[] = [];
    for (const filePart of message.files) {
      if (filePart.file?.type.startsWith("image/")) {
        try {
          const base64 = await convertFileToBase64(filePart.file);
          images.push({
            base64,
            mimeType: filePart.file.type,
          });
        } catch (e) {
          console.error("Failed to convert file to base64", e);
        }
      }
    }

    addUserMessage(message.text, images.length > 0 ? images : undefined);
  };

  const { data: projectContext } = trpc.getProjectContext.useQuery(
    { chatId: chatId || "" },
    { enabled: !!chatId }
  );

  const { setFiles } = useFileStore();

  useEffect(() => {
    if (projectContext?.files) {
      setFiles(projectContext.files);
    }
  }, [projectContext, setFiles]);

  return (
    <div className="relative flex size-full flex-col divide-y overflow-hidden">
      <ChatHeader
        activeAgentId={activeAgentId}
        agentModels={agentModels}
        connStatus={connStatus}
        isResuming={resumeSessionMutation.isPending}
        onNewChat={handleNewChat}
        onResumeChat={handleResume}
        onSettingsClick={() => setIsOpen(true)}
        onStopChat={handleStopChat}
      />

      <ChatMessages
        messages={messages}
        onApprove={handleApproveTool}
        onReject={handleRejectTool}
        terminalOutputs={terminalOutputs}
      />

      <ChatInput
        activeTabs={projectContext?.activeTabs}
        availableCommands={availableCommands}
        availableModels={availableModels}
        availableModes={availableModes}
        connStatus={connStatus}
        currentModeId={currentModeId}
        currentModelId={currentModelId}
        onCancel={handleCancel}
        onModeChange={handleSetMode}
        onModelChange={handleSetModel}
        onSubmit={handleSubmit}
        projectRules={projectContext?.projectRules}
        status={status}
        textareaRef={textareaRef}
      />

      <SettingsDialog />
    </div>
  );
}

interface ToolCallContent {
  toolCallId: string;
  kind?: string;
  title?: string;
  status?: string;
  rawInput?: Record<string, unknown>;
  content?: Array<{
    type: string;
    text?: string;
    terminalId?: string;
    path?: string;
    oldText?: string;
    newText?: string;
  }>;
}

interface ToolCallUpdateContent {
  toolCallId: string;
  status?: string;
  content?: Array<{
    type: string;
    content?: { text: string };
    terminalId?: string;
    path?: string;
    oldText?: string;
    newText?: string;
  }>;
}
