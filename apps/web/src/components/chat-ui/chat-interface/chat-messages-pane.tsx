import type { ChatStatus } from "@repo/shared";
import { ChatMessages } from "@/components/chat-ui/chat-messages";
import { shouldShowThinkingPlaceholder } from "@/components/chat-ui/chat-thinking-placeholder";
import {
  useChatMessageIds,
  useChatStreamStore,
} from "@/store/chat-stream-store";

interface ChatMessagesPaneProps {
  chatId: string | null;
  status: ChatStatus;
  canLoadOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
}

export function ChatMessagesPane({
  chatId,
  status,
  canLoadOlder,
  isLoadingOlder,
  onLoadOlder,
}: ChatMessagesPaneProps) {
  const messageIds = useChatMessageIds(chatId);
  const showThinkingPlaceholder = useChatStreamStore((state) => {
    if (!chatId) {
      return false;
    }
    return shouldShowThinkingPlaceholder({
      messages: state.byChatId[chatId]?.messageState.orderedMessages ?? [],
      status,
    });
  });
  return (
    <ChatMessages
      canLoadOlder={canLoadOlder}
      chatId={chatId}
      isLoadingOlder={isLoadingOlder}
      messageIds={messageIds}
      onLoadOlder={onLoadOlder}
      showThinkingPlaceholder={showThinkingPlaceholder}
    />
  );
}
