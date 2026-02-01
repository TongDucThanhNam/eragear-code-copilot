import { FlashList } from "@shopify/flash-list";
import { useMemo } from "react";
import type { ScrollViewProps } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import type { ChatMessage } from "@/store/chat-store";
import { MessageItem } from "./message-item";

interface ChatMessagesProps {
  messages: ChatMessage[];
  terminalOutputs: Map<string, string>;
  isStreaming: boolean;
  contentPaddingBottom?: number;
  keyboardBottomOffset?: number;
}

export function ChatMessages({
  messages,
  terminalOutputs,
  isStreaming,
  contentPaddingBottom = 100,
  keyboardBottomOffset = 0,
}: ChatMessagesProps) {
  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") {
        return messages[i]?.id ?? null;
      }
    }
    return null;
  }, [messages]);
  const listPaddingBottom = Math.max(100, contentPaddingBottom);
  const renderScrollComponent = (props: ScrollViewProps) => (
    <KeyboardAwareScrollView {...props} bottomOffset={keyboardBottomOffset} />
  );

  return (
    <FlashList
      contentContainerStyle={{
        padding: 16,
        paddingTop: 12,
        paddingBottom: listPaddingBottom,
      }}
      data={messages}
      // estimatedItemSize={100}
      // inverted={false}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <MessageItem
          isLiveMessage={isStreaming && item.id === lastAssistantMessageId}
          message={item}
          terminalOutputs={terminalOutputs}
        />
      )}
      renderScrollComponent={renderScrollComponent}
    />
  );
}
