import type { ChatStatus } from "@repo/shared";
import { ChatMessages } from "@/components/chat-ui/chat-messages";
import { shouldShowThinkingPlaceholder } from "@/components/chat-ui/chat-thinking-placeholder";
import {
  useChatMessageIds,
  useChatMessages,
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
  const messages = useChatMessages(chatId);
  const showThinkingPlaceholder = shouldShowThinkingPlaceholder({
    messages,
    status,
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
