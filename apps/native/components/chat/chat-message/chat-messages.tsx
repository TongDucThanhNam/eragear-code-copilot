import type { UIMessage } from "@repo/shared";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useChatStore } from "@/store/chat-store";
import { MemoizedMessageItem } from "./message-item";

const NEAR_BOTTOM_THRESHOLD = 96;
const USER_BUBBLE_WIDTH_RATIO = 0.82;

const MessageSeparator = memo(function MessageSeparator() {
  return <View className="h-3" />;
});

interface ChatMessagesProps {
  messageIds: string[];
  isStreaming: boolean;
  contentPaddingBottom?: number;
}

interface DerivedMessage {
  message: UIMessage;
  isLiveMessage: boolean;
}

function ChatMessagesComponent({
  messageIds,
  isStreaming,
  contentPaddingBottom = 100,
}: ChatMessagesProps) {
  const { width } = useWindowDimensions();
  const bubbleMaxWidth = useMemo(
    () => Math.max(180, Math.floor(width * USER_BUBBLE_WIDTH_RATIO)),
    [width]
  );

  const listRef = useRef<FlatList<DerivedMessage>>(null);
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const prevLastMessageIdRef = useRef<string | null>(null);

  // Derive UIMessage[] in one pass - no per-row subscriptions
  const { messagesById } = useChatStore.getState();
  const derivedMessages = useMemo(() => {
    const result: DerivedMessage[] = [];
    let lastAssistantId: string | null = null;

    // Find last assistant message ID
    for (let i = messageIds.length - 1; i >= 0; i -= 1) {
      const msg = messagesById.get(messageIds[i] ?? "");
      if (msg?.role === "assistant") {
        lastAssistantId = msg.id;
        break;
      }
    }

    for (const id of messageIds) {
      const message = messagesById.get(id);
      if (message) {
        result.push({
          message,
          isLiveMessage: isStreaming && id === lastAssistantId,
        });
      }
    }
    return result;
  }, [messageIds, messagesById, isStreaming]);

  const hasMessages = derivedMessages.length > 0;
  const listPaddingBottom = Math.max(96, contentPaddingBottom);

  // Auto-scroll to bottom when messages change AND user is near bottom
  const currentMessageCount = derivedMessages.length;
  const currentLastMessageId = derivedMessages.at(-1)?.message.id ?? null;

  useEffect(() => {
    const messageCountChanged =
      currentMessageCount !== prevMessageCountRef.current;
    const lastMessageChanged =
      currentLastMessageId !== prevLastMessageIdRef.current;

    prevMessageCountRef.current = currentMessageCount;
    prevLastMessageIdRef.current = currentLastMessageId;

    // Only auto-scroll if:
    // 1. User is near bottom
    // 2. New message added OR streaming content changed
    if (
      isNearBottomRef.current &&
      (messageCountChanged || (isStreaming && lastMessageChanged))
    ) {
      // Use requestAnimationFrame for better timing on Android
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: false });
      });
    }
  }, [currentMessageCount, currentLastMessageId, isStreaming]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      const distanceFromBottom =
        contentSize.height - layoutMeasurement.height - contentOffset.y;
      isNearBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD;
    },
    []
  );

  const keyExtractor = useCallback(
    (item: DerivedMessage) => item.message.id,
    []
  );
  const renderItem = useCallback(
    ({ item }: { item: DerivedMessage }) => (
      <MemoizedMessageItem
        bubbleMaxWidth={bubbleMaxWidth}
        isLiveMessage={item.isLiveMessage}
        message={item.message}
      />
    ),
    [bubbleMaxWidth]
  );

  const emptyState = useMemo(
    () => (
      <View className="flex-1 items-center justify-center px-10">
        <Text className="text-center font-semibold text-foreground text-lg">
          Start a conversation
        </Text>
        <Text className="mt-2 text-center text-muted-foreground text-sm leading-6">
          Ask for code changes, debugging help, or type `/` to use a command.
        </Text>
      </View>
    ),
    []
  );
  const contentContainerStyle = useMemo(
    () => ({
      flexGrow: 1,
      paddingHorizontal: hasMessages ? 18 : 24,
      paddingTop: hasMessages ? 12 : 24,
      paddingBottom: hasMessages ? listPaddingBottom : 32,
    }),
    [hasMessages, listPaddingBottom]
  );

  return (
    <FlatList
      contentContainerStyle={contentContainerStyle}
      data={derivedMessages}
      ItemSeparatorComponent={MessageSeparator}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      keyExtractor={keyExtractor}
      ListEmptyComponent={hasMessages ? null : emptyState}
      onScroll={handleScroll}
      ref={listRef}
      removeClippedSubviews={false}
      renderItem={renderItem}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
    />
  );
}

export const ChatMessages = memo(ChatMessagesComponent);
