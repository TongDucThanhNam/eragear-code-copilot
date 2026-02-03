"use client";

import type { UIMessage } from "@repo/shared";
import { memo } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { AgenticMessage } from "@/components/chat-ui/agentic-message";

export interface ChatMessagesProps {
  messages: UIMessage[];
  terminalOutputs?: Record<string, string>;
  onApprove?: (requestId: string, decision?: string) => void;
  onReject?: (requestId: string, decision?: string) => void;
}

const ChatMessagesBase = ({
  messages,
  terminalOutputs,
  onApprove,
  onReject,
}: ChatMessagesProps) {
  return (
    <Conversation className="min-h-0 flex-1 overflow-y-hidden">
      <ConversationContent>
        {messages.map((message) => (
          <AgenticMessage
            key={message.id}
            message={message}
            onApprove={onApprove}
            onReject={onReject}
            terminalOutputs={terminalOutputs}
          />
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
};

export const ChatMessages = memo(
  ChatMessagesBase,
  (prevProps, nextProps) =>
    prevProps.messages === nextProps.messages &&
    prevProps.terminalOutputs === nextProps.terminalOutputs &&
    prevProps.onApprove === nextProps.onApprove &&
    prevProps.onReject === nextProps.onReject
);
ChatMessages.displayName = "ChatMessages";
