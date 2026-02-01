import { FlashList } from "@shopify/flash-list";
import { useMemo } from "react";
import type { ScrollViewProps } from "react-native";
import { Text, View } from "react-native";
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
  const hasMessages = messages.length > 0;
  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") {
        return messages[i]?.id ?? null;
      }
    }
    return null;
  }, [messages]);
  const listPaddingBottom = Math.max(96, contentPaddingBottom);
  const renderScrollComponent = (props: ScrollViewProps) => (
    <KeyboardAwareScrollView {...props} bottomOffset={keyboardBottomOffset} />
  );
  const renderEmptyState = () => (
    <View className="flex-1 items-center justify-center px-8">
      <Text className="text-muted text-sm">No messages yet.</Text>
      <Text className="mt-1 text-center text-muted text-xs">
        Start by sending a prompt.
      </Text>
    </View>
  );
  const contentContainerStyle = {
    flexGrow: 1,
    paddingHorizontal: hasMessages ? 18 : 24,
    paddingTop: hasMessages ? 12 : 24,
    paddingBottom: hasMessages ? listPaddingBottom : 32,
  };

  return (
    <FlashList
      contentContainerStyle={contentContainerStyle}
      data={messages}
      estimatedItemSize={180}
      ItemSeparatorComponent={() => <View className="h-4" />}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item, index) => item.id ?? `${item.role}-${index}`}
      ListEmptyComponent={hasMessages ? null : renderEmptyState}
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
