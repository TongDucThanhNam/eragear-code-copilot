"use client";

import { memo } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Message,
  MessageContent,
} from "@/components/ai-elements/message";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { AgenticMessage } from "@/components/chat-ui/agentic-message";
import { Button } from "@/components/ui/button";

export interface ChatMessagesProps {
  chatId: string | null;
  messageIds: readonly string[];
  showThinkingPlaceholder?: boolean;
  canLoadOlder?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => void;
}

const ThinkingMessagePlaceholder = memo(function ThinkingMessagePlaceholder() {
  return (
    <Message from="assistant">
      <MessageContent className="text-muted-foreground text-sm">
        <div aria-live="polite" role="status">
          <Shimmer duration={1}>Thinking...</Shimmer>
        </div>
      </MessageContent>
    </Message>
  );
});

export const ChatMessages = memo(function ChatMessages({
  chatId,
  messageIds,
  showThinkingPlaceholder = false,
  canLoadOlder = false,
  isLoadingOlder = false,
  onLoadOlder,
}: ChatMessagesProps) {
  return (
    <Conversation className="h-full min-h-0">
      <ConversationContent className="mx-auto w-full max-w-4xl gap-6 px-3 pt-4 pb-4 sm:px-5">
        {canLoadOlder && onLoadOlder ? (
          <div className="flex justify-center">
            <Button
              disabled={isLoadingOlder}
              onClick={onLoadOlder}
              size="sm"
              type="button"
              variant="ghost"
            >
              {isLoadingOlder
                ? "Loading older messages..."
                : "Load older messages"}
            </Button>
          </div>
        ) : null}
        {messageIds.map((messageId) => (
          <AgenticMessage
            chatId={chatId}
            key={messageId}
            messageId={messageId}
          />
        ))}
        {showThinkingPlaceholder ? <ThinkingMessagePlaceholder /> : null}
      </ConversationContent>
      <ConversationScrollButton className="bottom-5 z-10 shadow-sm" />
    </Conversation>
  );
},
  (prevProps, nextProps) =>
    prevProps.chatId === nextProps.chatId &&
    prevProps.messageIds === nextProps.messageIds &&
    prevProps.showThinkingPlaceholder === nextProps.showThinkingPlaceholder &&
    prevProps.canLoadOlder === nextProps.canLoadOlder &&
    prevProps.isLoadingOlder === nextProps.isLoadingOlder &&
    prevProps.onLoadOlder === nextProps.onLoadOlder
);
