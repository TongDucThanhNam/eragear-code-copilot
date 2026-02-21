"use client";

import type { UIMessage } from "@repo/shared";
import { memo } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { AgenticMessage } from "@/components/chat-ui/agentic-message";
import { Button } from "@/components/ui/button";

export interface ChatMessagesProps {
  messages: UIMessage[];
  terminalOutputs?: Record<string, string>;
  canLoadOlder?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => void;
}

const ChatMessagesBase = ({
  messages,
  terminalOutputs,
  canLoadOlder = false,
  isLoadingOlder = false,
  onLoadOlder,
}: ChatMessagesProps) => (
  <Conversation className="h-full min-h-0">
    <ConversationContent className="mx-auto w-full max-w-4xl gap-6 px-3 pb-4 pt-4 sm:px-5">
      {canLoadOlder && onLoadOlder ? (
        <div className="flex justify-center">
          <Button
            disabled={isLoadingOlder}
            onClick={onLoadOlder}
            size="sm"
            type="button"
            variant="ghost"
          >
            {isLoadingOlder ? "Loading older messages..." : "Load older messages"}
          </Button>
        </div>
      ) : null}
      {messages.map((message) => (
        <AgenticMessage
          key={message.id}
          message={message}
          terminalOutputs={terminalOutputs}
        />
      ))}
    </ConversationContent>
    <ConversationScrollButton className="bottom-5 z-10 shadow-sm" />
  </Conversation>
);

export const ChatMessages = memo(
  ChatMessagesBase,
  (prevProps, nextProps) =>
    prevProps.messages === nextProps.messages &&
    prevProps.terminalOutputs === nextProps.terminalOutputs &&
    prevProps.canLoadOlder === nextProps.canLoadOlder &&
    prevProps.isLoadingOlder === nextProps.isLoadingOlder &&
    prevProps.onLoadOlder === nextProps.onLoadOlder
);
ChatMessages.displayName = "ChatMessages";
