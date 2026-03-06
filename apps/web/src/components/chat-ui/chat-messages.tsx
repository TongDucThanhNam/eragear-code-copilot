"use client";

import { memo } from "react";
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
  canLoadOlder?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => void;
}

export const ChatMessages = memo(function ChatMessages({
  chatId,
  messageIds,
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
      </ConversationContent>
      <ConversationScrollButton className="bottom-5 z-10 shadow-sm" />
    </Conversation>
  );
},
  (prevProps, nextProps) =>
    prevProps.chatId === nextProps.chatId &&
    prevProps.messageIds === nextProps.messageIds &&
    prevProps.canLoadOlder === nextProps.canLoadOlder &&
    prevProps.isLoadingOlder === nextProps.isLoadingOlder &&
    prevProps.onLoadOlder === nextProps.onLoadOlder
);
