import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useChatStore } from "@/store/chat-store";

interface UseDeleteSessionResult {
  deleteSession: (chatId: string) => Promise<boolean>;
  isDeleting: boolean;
}

/**
 * Hook for deleting ACP sessions.
 * Cleans up active chat state and refreshes cached session data.
 */
export function useDeleteSession(): UseDeleteSessionResult {
  const utils = trpc.useUtils();
  const deleteSessionMutation = trpc.deleteSession.useMutation();

  const deleteSession = useCallback(
    async (chatId: string): Promise<boolean> => {
      if (!chatId) {
        const message = "Chat ID is required to delete a session.";
        useChatStore.getState().setError(message);
        return false;
      }

      try {
        await deleteSessionMutation.mutateAsync({ chatId });
        const store = useChatStore.getState();

        if (store.activeChatId === chatId) {
          store.setActiveChatId(null);
        }

        store.removeSession(chatId);
        store.clearChatFailed(chatId);

        await utils.getSessions.invalidate();
        await utils.getSessionMessages.invalidate({ chatId });
        return true;
      } catch (err) {
        const message =
          typeof err === "object" && err && "message" in err
            ? String((err as { message: string }).message)
            : "Failed to delete session.";
        useChatStore.getState().setError(message);
        return false;
      }
    },
    [deleteSessionMutation, utils]
  );

  return {
    deleteSession,
    isDeleting: deleteSessionMutation.isPending,
  };
}
