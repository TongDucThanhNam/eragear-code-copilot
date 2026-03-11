import React, { useMemo } from "react";
import { View } from "react-native";
import { splitMessageParts } from "./agentic-message-utils";
import { MessageActions } from "./message-actions";
import { MessageHeader } from "./message-header";
import { UserMessageBody } from "./user-message-body";
import { AssistantMessageBody } from "./assistant-message-body";
import { extractMessageText } from "./message-item.utils";
import type { MessageItemProps } from "./message-item.types";

export function MessageItem({
  bubbleMaxWidth,
  message,
  isLiveMessage,
}: MessageItemProps) {
  const isUser = message.role === "user";
  const assistantRenderData = useMemo(
    () =>
      message.role === "assistant" ? splitMessageParts(message.parts) : null,
    [message.parts, message.role]
  );
  const messageText = useMemo(
    () =>
      assistantRenderData?.finalText ??
      (message.role === "assistant" ? extractMessageText(message.parts) : ""),
    [assistantRenderData?.finalText, message.parts, message.role]
  );
  const showActions =
    message.role === "assistant" && !isLiveMessage && messageText.length > 0;

  const renderMessageBody = () => {
    if (isUser) {
      return (
        <UserMessageBody
          bubbleMaxWidth={bubbleMaxWidth}
          parts={message.parts}
        />
      );
    }
    if (assistantRenderData) {
      return (
        <View className="w-full">
          <AssistantMessageBody
            data={assistantRenderData}
            isLiveMessage={isLiveMessage}
            messageId={message.id}
            parts={message.parts}
          />
          {showActions && (
            <MessageActions className="self-start" text={messageText} />
          )}
        </View>
      );
    }
    return null;
  };

  return (
    <View className="w-full">
      <MessageHeader isLiveMessage={isLiveMessage} message={message} />
      {renderMessageBody()}
    </View>
  );
}

// Custom comparison for React.memo to prevent unnecessary re-renders
function propsAreEqual(
  prev: MessageItemProps,
  next: MessageItemProps
): boolean {
  // Only re-render if message content changed, bubble width changed, or live status changed
  if (prev.message.id !== next.message.id) {
    return false;
  }
  if (prev.message.parts !== next.message.parts) {
    return false;
  }
  if (prev.isLiveMessage !== next.isLiveMessage) {
    return false;
  }
  if (prev.bubbleMaxWidth !== next.bubbleMaxWidth) {
    return false;
  }
  return true;
}

export const MemoizedMessageItem = React.memo(MessageItem, propsAreEqual);
