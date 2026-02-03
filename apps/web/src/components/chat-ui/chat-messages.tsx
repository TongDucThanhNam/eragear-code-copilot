"use client";

import type { UIMessage } from "@repo/shared";
import { useMemo } from "react";
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

export function ChatMessages({
  messages,
  terminalOutputs,
  onApprove,
  onReject,
}: ChatMessagesProps) {
  const memoizedMessages = useMemo(() => messages, [messages]);

  return (
    <Conversation className="min-h-0 flex-1 overflow-y-hidden">
      <ConversationContent>
        {memoizedMessages.map((message) => (
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
}
