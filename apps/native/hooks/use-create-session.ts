import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useChatStore } from "@/store/chat-store";
import type { Agent } from "@/store/settings-store";

interface CreateSessionResult {
  chatId: string;
}

interface UseCreateSessionReturn {
  createSession: (
    agent: Agent,
    projectId: string
  ) => Promise<CreateSessionResult>;
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
    setError,
  } = useChatStore();

  const utils = trpc.useUtils();
  const createSessionMutation = trpc.createSession.useMutation();
  const setActiveAgentMutation = trpc.agents.setActive.useMutation();

  const createSession = useCallback(
    async (agent: Agent, projectId: string): Promise<CreateSessionResult> => {
      // Set active agent
      setActiveAgentMutation.mutate({ id: agent.id });

      // Set connecting status
      setConnStatus("connecting");

      try {
        // Create session with agent config
        const data = await createSessionMutation.mutateAsync({
          projectId,
          command: agent.command,
          args: agent.args,
          env: agent.env,
        });

        // Update store with session info
        setActiveChatId(data.chatId);

        if (data.modes) {
          setModes(data.modes);
        }

        if (data.models) {
          setModels(data.models);
        }

        setPromptCapabilities(data.promptCapabilities ?? null);
        setConnStatus("connected");

        // Fetch session state to get additional capabilities
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

        // Invalidate sessions to refresh the list
        await utils.getSessions.invalidate();

        return { chatId: data.chatId };
      } catch (err) {
        const message =
          typeof err === "object" && err && "message" in err
            ? String((err as { message: string }).message)
            : "Failed to create session.";

        setConnStatus("error");
        setError(message);
        throw new Error(message);
      }
    },
    [
      setActiveAgentMutation,
      setConnStatus,
      createSessionMutation,
      setActiveChatId,
      setModes,
      setModels,
      setPromptCapabilities,
      setSupportsModelSwitching,
      setError,
      utils,
    ]
  );

  return {
    createSession,
    isCreating: createSessionMutation.isPending,
  };
}
