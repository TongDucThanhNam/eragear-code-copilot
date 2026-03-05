import { ChatPlanDock } from "@/components/chat-ui/chat-plan-dock";
import { useChatMessages } from "@/store/chat-stream-store";

interface ChatPlanDockPaneProps {
  chatId: string | null;
}

export function ChatPlanDockPane({ chatId }: ChatPlanDockPaneProps) {
  const messages = useChatMessages(chatId);
  return <ChatPlanDock messages={messages} />;
}
