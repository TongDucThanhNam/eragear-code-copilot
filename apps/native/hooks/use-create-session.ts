import type { AgentInfo, ChatStatus } from "@repo/shared";
import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import type {
  PromptCapabilities,
  SessionModelState,
  SessionModeState,
} from "@/store/chat-store";
import { useChatStore } from "@/store/chat-store";
import type { Agent } from "@/store/settings-store";

interface CreateSessionResult {
  chatId: string;
}

interface SessionBootstrapPayload {
  chatId: string;
  chatStatus?: ChatStatus | null;
  modes?: SessionModeState | null;
  models?: SessionModelState | null;
  promptCapabilities?: PromptCapabilities | null;
  agentInfo?: AgentInfo | null;
  loadSessionSupported?: boolean;
}

interface UseCreateSessionReturn {
  createSession: (
    agent: Agent,
    projectId: string
  ) => Promise<CreateSessionResult>;
  loadAgentSession: (params: {
    agent: Agent;
    projectId: string;
    sessionId: string;
  }) => Promise<CreateSessionResult>;
  isCreating: boolean;
}

/**
 * Hook for creating new ACP sessions.
 * Centralizes session creation logic from agent selection.
 */
export function useCreateSession(): UseCreateSessionReturn {
  const {
    setActiveChatId,
    setConnStatus,
    setModes,
    setModels,
    setPromptCapabilities,
    setSupportsModelSwitching,
    setAgentInfo,
    setLoadSessionSupported,
    setStatus,
    setError,
  } = useChatStore();

  const utils = trpc.useUtils();
  const createSessionMutation = trpc.createSession.useMutation();
  const loadAgentSessionMutation = trpc.loadAgentSession.useMutation();
  const setActiveAgentMutation = trpc.agents.setActive.useMutation();

  const applySessionBootstrapState = useCallback(
    async (data: SessionBootstrapPayload) => {
      setActiveChatId(data.chatId);

      if (data.modes) {
        setModes(data.modes);
      }

      if (data.models) {
        setModels(data.models);
      }

      setPromptCapabilities(data.promptCapabilities ?? null);
      setAgentInfo(data.agentInfo ?? null);
      setLoadSessionSupported(data.loadSessionSupported);
      setConnStatus("connected");
      setStatus(data.chatStatus ?? "ready");

      try {
        const sessionState = await utils.getSessionState.fetch({
          chatId: data.chatId,
        });
        if (sessionState?.supportsModelSwitching !== undefined) {
          setSupportsModelSwitching(
            Boolean(sessionState.supportsModelSwitching)
          );
        }
      } catch (err) {
        console.warn("Failed to fetch session state", err);
      }

      await utils.getSessions.invalidate();
    },
    [
      setActiveChatId,
      setModes,
      setModels,
      setPromptCapabilities,
      setAgentInfo,
      setLoadSessionSupported,
      setConnStatus,
      setStatus,
      utils.getSessionState,
      utils.getSessions,
      setSupportsModelSwitching,
    ]
  );

  const createSession = useCallback(
    async (agent: Agent, projectId: string): Promise<CreateSessionResult> => {
      // Set active agent
      setActiveAgentMutation.mutate({ id: agent.id });

      // Set connecting status
      setConnStatus("connecting");
      setStatus("connecting");

      try {
        // Create session with agent config
        const data = await createSessionMutation.mutateAsync({
          projectId,
          agentId: agent.id,
        });
        await applySessionBootstrapState(data);

        return { chatId: data.chatId };
      } catch (err) {
        const message =
          typeof err === "object" && err && "message" in err
            ? String((err as { message: string }).message)
            : "Failed to create session.";

        setConnStatus("error");
        setStatus("error");
        setError(message);
        throw new Error(message);
      }
    },
    [
      setActiveAgentMutation,
      setConnStatus,
      createSessionMutation,
      setStatus,
      setError,
      applySessionBootstrapState,
    ]
  );

  const loadAgentSession = useCallback(
    async (params: {
      agent: Agent;
      projectId: string;
      sessionId: string;
    }): Promise<CreateSessionResult> => {
      setActiveAgentMutation.mutate({ id: params.agent.id });
      setConnStatus("connecting");
      setStatus("connecting");
      try {
        const data = await loadAgentSessionMutation.mutateAsync({
          projectId: params.projectId,
          agentId: params.agent.id,
          sessionId: params.sessionId,
        });
        await applySessionBootstrapState(data);
        return { chatId: data.chatId };
      } catch (err) {
        const message =
          typeof err === "object" && err && "message" in err
            ? String((err as { message: string }).message)
            : "Failed to load session.";

        setConnStatus("error");
        setStatus("error");
        setError(message);
        throw new Error(message);
      }
    },
    [
      setActiveAgentMutation,
      setConnStatus,
      setStatus,
      loadAgentSessionMutation,
      applySessionBootstrapState,
      setError,
    ]
  );

  return {
    createSession,
    loadAgentSession,
    isCreating:
      createSessionMutation.isPending || loadAgentSessionMutation.isPending,
  };
}
