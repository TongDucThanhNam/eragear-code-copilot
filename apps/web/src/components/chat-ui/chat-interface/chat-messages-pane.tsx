import { ChatMessages } from "@/components/chat-ui/chat-messages";
import { useChatMessageIds } from "@/store/chat-stream-store";

interface ChatMessagesPaneProps {
  chatId: string | null;
  canLoadOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
}

export function ChatMessagesPane({
  chatId,
  canLoadOlder,
  isLoadingOlder,
  onLoadOlder,
}: ChatMessagesPaneProps) {
  const messageIds = useChatMessageIds(chatId);
  return (
    <ChatMessages
      canLoadOlder={canLoadOlder}
      chatId={chatId}
      isLoadingOlder={isLoadingOlder}
      messageIds={messageIds}
      onLoadOlder={onLoadOlder}
    />
  );
}
