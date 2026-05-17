"use client";

import { memo } from "react";
import { List, type RowComponentProps } from "react-window";
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

/**
 * Threshold for using virtualization.
 * Below this message count, render all normally to avoid overhead.
 */
const VIRTUALIZATION_THRESHOLD = 30;

/**
 * Estimated height of each message item in pixels.
 * This is used by react-window for initial estimation.
 */
const MESSAGE_ESTIMATED_HEIGHT = 120;

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

interface MessageItemData {
  chatId: string | null;
  messageIds: readonly string[];
}

function MessageItem({
  index,
  style,
  chatId,
  messageIds,
}: RowComponentProps<MessageItemData>) {
  const messageId = messageIds[index];
  return (
    <div style={style} className="py-2">
      <AgenticMessage chatId={chatId} messageId={messageId} />
    </div>
  );
}

MessageItem.displayName = "MessageItem";

/**
 * Shallow compare for messageIds array - optimized for common case of
 * messages being appended at the end. Falls back to length + first/last check.
 */
function shallowCompareMessageIds(
  prev: readonly string[],
  next: readonly string[]
): boolean {
  if (prev === next) {
    return true;
  }
  const len = prev.length;
  if (len !== next.length) {
    return false;
  }
  // Fast path: check first and last (common case of appending messages)
  if (len > 0) {
    if (prev[0] !== next[0]) {
      return false;
    }
    if (len > 1 && prev[len - 1] !== next[len - 1]) {
      // Length same but last differs - this is an insert/reorder, do full compare
      for (let i = 0; i < len; i++) {
        if (prev[i] !== next[i]) {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * VirtualizedChatMessages uses react-window for efficient rendering of long
 * message lists. Only renders visible messages + overscan.
 */
export const VirtualizedChatMessages = memo(function VirtualizedChatMessages({
  chatId,
  messageIds,
  showThinkingPlaceholder = false,
  canLoadOlder = false,
  isLoadingOlder = false,
  onLoadOlder,
}: ChatMessagesProps) {
  const itemData: MessageItemData = {
    chatId,
    messageIds,
  };

  return (
    <Conversation className="h-full min-h-0">
      <ConversationContent className="mx-auto w-full max-w-4xl gap-6 px-3 pt-4 pb-4 sm:px-5">
        {canLoadOlder && onLoadOlder ? (
          <div className="flex justify-center pb-2">
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
        <List
          overscanCount={5}
          rowComponent={MessageItem}
          rowCount={messageIds.length}
          rowHeight={MESSAGE_ESTIMATED_HEIGHT}
          rowProps={itemData}
          style={{ height: 600, width: "100%" }}
        />
        {showThinkingPlaceholder ? <ThinkingMessagePlaceholder /> : null}
      </ConversationContent>
      <ConversationScrollButton className="bottom-5 z-10 shadow-sm" />
    </Conversation>
  );
},
  (prevProps, nextProps) =>
    prevProps.chatId === nextProps.chatId &&
    shallowCompareMessageIds(prevProps.messageIds, nextProps.messageIds) &&
    prevProps.showThinkingPlaceholder === nextProps.showThinkingPlaceholder &&
    prevProps.canLoadOlder === nextProps.canLoadOlder &&
    prevProps.isLoadingOlder === nextProps.isLoadingOlder &&
    prevProps.onLoadOlder === nextProps.onLoadOlder
);

/**
 * Auto-switching ChatMessages that uses virtualization only when needed.
 * Below VIRTUALIZATION_THRESHOLD, renders normally to avoid virtualization overhead.
 */
export const ChatMessages = memo(function ChatMessages({
  chatId,
  messageIds,
  showThinkingPlaceholder = false,
  canLoadOlder = false,
  isLoadingOlder = false,
  onLoadOlder,
}: ChatMessagesProps) {
  // Use virtualization for large message lists
  if (messageIds.length >= VIRTUALIZATION_THRESHOLD) {
    return (
      <VirtualizedChatMessages
        chatId={chatId}
        messageIds={messageIds}
        showThinkingPlaceholder={showThinkingPlaceholder}
        canLoadOlder={canLoadOlder}
        isLoadingOlder={isLoadingOlder}
        onLoadOlder={onLoadOlder}
      />
    );
  }

  // Normal rendering for small message lists
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
    shallowCompareMessageIds(prevProps.messageIds, nextProps.messageIds) &&
    prevProps.showThinkingPlaceholder === nextProps.showThinkingPlaceholder &&
    prevProps.canLoadOlder === nextProps.canLoadOlder &&
    prevProps.isLoadingOlder === nextProps.isLoadingOlder &&
    prevProps.onLoadOlder === nextProps.onLoadOlder
);
