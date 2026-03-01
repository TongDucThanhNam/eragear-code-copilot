import type { UIMessage, UIMessagePart } from "@repo/shared";
import React, { useMemo } from "react";
import { Linking, Text, View } from "react-native";
import { useChatStore } from "@/store/chat-store";
import { ChainOfThought } from "./agentic-chain";
import {
  type FilePart,
  isDataPart,
  isMessageStreaming,
  resolveAssistantFinalVisibility,
  type SourcePart,
  splitMessageParts,
} from "./agentic-message-utils";
import { AttachmentBadge } from "./attachment-badge";
import { MessageActions } from "./message-actions";
import { MessagePartItem } from "./message-part-item";
import MarkdownText from "./text-part";
import { cn_inline, getPartKey } from "./utils";

// Format timestamp for messages
function formatMessageTime(timestamp: number | undefined): string {
  const date = timestamp ? new Date(timestamp) : new Date();
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Get timestamp from message — prefer createdAt, then metadata, then now
function getMessageTimestamp(message: UIMessage): number {
  if (typeof message.createdAt === "number") {
    return message.createdAt;
  }
  if (message.metadata && typeof message.metadata === "object") {
    const meta = message.metadata as Record<string, unknown>;
    if (typeof meta.timestamp === "number") {
      return meta.timestamp;
    }
  }
  return Date.now();
}

const extractMessageText = (parts: UIMessage["parts"]) =>
  parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n\n");

const AttachmentList = ({ items }: { items: Array<SourcePart | FilePart> }) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <View className="flex-row flex-wrap gap-2">
      {items.map((part, index) => {
        if (part.type === "source-url") {
          const label = part.title ?? part.url;
          return (
            <AttachmentBadge
              key={getPartKey(part, index)}
              label={label}
              onPress={() => Linking.openURL(part.url)}
            />
          );
        }
        if (part.type === "source-document") {
          const label = part.title ?? part.filename ?? part.sourceId;
          return (
            <AttachmentBadge key={getPartKey(part, index)} label={label} />
          );
        }
        const label = part.filename ?? part.mediaType ?? "File";
        return <AttachmentBadge key={getPartKey(part, index)} label={label} />;
      })}
    </View>
  );
};

const UserMessageBody = ({ parts }: { parts: UIMessagePart[] }) => {
  const displayParts = useMemo(
    () => parts.filter((part) => !isDataPart(part)),
    [parts]
  );

  return (
    <View className="flex-col items-end gap-1.5">
      <View
        className={cn_inline(
          "flex-col gap-1.5 rounded-2xl px-4 py-3",
          "max-w-[82%] self-end bg-accent text-white"
        )}
      >
        {displayParts.map((part, index) => (
          <MessagePartItem key={getPartKey(part, index)} part={part} />
        ))}
      </View>
    </View>
  );
};

const AssistantMessageBody = ({
  message,
  isLiveMessage,
}: {
  message: UIMessage;
  isLiveMessage: boolean;
}) => {
  const { chainItems, finalText, finalAttachments } = useMemo(
    () => splitMessageParts(message.parts),
    [message.parts]
  );
  const isStreaming = isMessageStreaming(message.parts) || isLiveMessage;
  const finalVisibility = resolveAssistantFinalVisibility({
    finalText,
    finalAttachmentsCount: finalAttachments.length,
    isStreaming,
    chainItemsCount: chainItems.length,
  });

  if (chainItems.length === 0) {
    // Use the pre-merged finalText from splitMessageParts to prevent
    // markdown fragmentation when text is split across multiple parts
    // (server may split text due to streaming state transitions).
    return (
      <View className="flex-col items-start gap-1.5">
        <View
          className={cn_inline(
            "flex-col gap-1.5 rounded-2xl px-4 py-3",
            "max-w-[88%] self-start bg-surface-foreground/5"
          )}
        >
          {finalText ? <MarkdownText>{finalText}</MarkdownText> : null}
          {finalAttachments.length > 0 ? (
            <AttachmentList items={finalAttachments} />
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View className="flex-col gap-3">
      <ChainOfThought
        isStreaming={isStreaming}
        items={chainItems}
        messageId={message.id}
      />
      {finalVisibility.shouldRenderFinal && (
        <View className="flex-col gap-3">
          {finalVisibility.showFinalText && finalText ? (
            <MarkdownText>{finalText}</MarkdownText>
          ) : null}
          {finalVisibility.showFinalAttachments ? (
            <AttachmentList items={finalAttachments} />
          ) : null}
        </View>
      )}
    </View>
  );
};

const MessageHeader = ({
  message,
  isLiveMessage,
}: {
  message: UIMessage;
  isLiveMessage: boolean;
}) => {
  const isUserMessage = message.role === "user";
  return (
    <View className="mb-1.5 flex-row items-center gap-2">
      <Text className="text-[10px] text-muted-foreground">
        {isUserMessage ? "You" : "Assistant"}
      </Text>
      <Text className="text-[10px] text-muted-foreground/50">·</Text>
      <Text className="text-[10px] text-muted-foreground/70">
        {formatMessageTime(getMessageTimestamp(message))}
      </Text>
      {isLiveMessage && !isUserMessage && (
        <View className="flex-row items-center gap-1">
          <View className="h-1.5 w-1.5 rounded-full bg-accent" />
          <Text className="text-[10px] text-accent">Thinking...</Text>
        </View>
      )}
    </View>
  );
};

interface MessageItemProps {
  message: UIMessage;
  isLiveMessage: boolean;
}

interface MessageItemContainerProps {
  messageId: string;
  isLiveMessage: boolean;
}

export function MessageItem({ message, isLiveMessage }: MessageItemProps) {
  const isUser = message.role === "user";
  const messageText = useMemo(
    () =>
      message.role === "assistant" ? extractMessageText(message.parts) : "",
    [message.role, message.parts]
  );
  const showActions =
    message.role === "assistant" && !isLiveMessage && messageText.length > 0;

  return (
    <View className="w-full">
      <MessageHeader isLiveMessage={isLiveMessage} message={message} />
      {isUser ? (
        <UserMessageBody parts={message.parts} />
      ) : (
        <View className="w-full">
          <AssistantMessageBody
            isLiveMessage={isLiveMessage}
            message={message}
          />
          {showActions && (
            <MessageActions className="self-start" text={messageText} />
          )}
        </View>
      )}
    </View>
  );
}

function MessageItemContainer({
  messageId,
  isLiveMessage,
}: MessageItemContainerProps) {
  const message = useChatStore((state) => state.messagesById.get(messageId));
  if (!message) {
    return null;
  }
  return (
    <MemoizedMessageItem isLiveMessage={isLiveMessage} message={message} />
  );
}

// Custom comparison for React.memo to prevent unnecessary re-renders
function propsAreEqual(
  prev: MessageItemProps,
  next: MessageItemProps
): boolean {
  // Only re-render if message content changed or live status changed
  if (prev.message.id !== next.message.id) {
    return false;
  }
  if (prev.message.parts !== next.message.parts) {
    return false;
  }
  if (prev.isLiveMessage !== next.isLiveMessage) {
    return false;
  }
  return true;
}

export const MemoizedMessageItem = React.memo(MessageItem, propsAreEqual);

function containerPropsAreEqual(
  prev: MessageItemContainerProps,
  next: MessageItemContainerProps
): boolean {
  if (prev.messageId !== next.messageId) {
    return false;
  }
  if (prev.isLiveMessage !== next.isLiveMessage) {
    return false;
  }
  return true;
}

export const MemoizedMessageItemContainer = React.memo(
  MessageItemContainer,
  containerPropsAreEqual
);
