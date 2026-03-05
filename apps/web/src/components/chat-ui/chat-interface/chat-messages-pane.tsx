import { ChatMessages } from "@/components/chat-ui/chat-messages";
import {
  useChatMessages,
  useChatTerminalOutputs,
} from "@/store/chat-stream-store";

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
  const messages = useChatMessages(chatId);
  const terminalOutputs = useChatTerminalOutputs(chatId);
  return (
    <ChatMessages
      canLoadOlder={canLoadOlder}
      isLoadingOlder={isLoadingOlder}
      messages={messages}
      onLoadOlder={onLoadOlder}
      terminalOutputs={terminalOutputs}
    />
  );
}
