import type { UIMessage } from "@repo/shared";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  type LayoutChangeEvent,
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
  isStreaming: boolean;
  contentPaddingBottom?: number;
}

interface MessageListRowProps {
  bubbleMaxWidth: number;
  isLiveMessage: boolean;
  messageId: string;
  onLiveLayout: () => void;
}

const MessageListRow = memo(
  function MessageListRow({
    bubbleMaxWidth,
    isLiveMessage,
    messageId,
    onLiveLayout,
  }: MessageListRowProps) {
    const selectMessage = useCallback(
      (state: ReturnType<typeof useChatStore.getState>) =>
        state.messagesById.get(messageId),
      [messageId]
    );
    const message = useChatStore(selectMessage);

    const handleLayout = useCallback(
      (_event: LayoutChangeEvent) => {
        if (isLiveMessage) {
          onLiveLayout();
        }
      },
      [isLiveMessage, onLiveLayout]
    );

    if (!message) {
      return null;
    }

    return (
      <View onLayout={handleLayout}>
        <MemoizedMessageItem
          bubbleMaxWidth={bubbleMaxWidth}
          isLiveMessage={isLiveMessage}
          message={message}
        />
      </View>
    );
  },
  (prev, next) =>
    prev.bubbleMaxWidth === next.bubbleMaxWidth &&
    prev.isLiveMessage === next.isLiveMessage &&
    prev.messageId === next.messageId &&
    prev.onLiveLayout === next.onLiveLayout
);

function findLastAssistantMessageId(messageIds: string[]): string | null {
  const { messagesById } = useChatStore.getState();

  for (let index = messageIds.length - 1; index >= 0; index -= 1) {
    const message = messagesById.get(messageIds[index] ?? "");
    if (message?.role === "assistant") {
      return message.id;
    }
  }

  return null;
}

function getMessageItemType(messageId: string): UIMessage["role"] | "message" {
  return useChatStore.getState().messagesById.get(messageId)?.role ?? "message";
}

interface LiveMessageExtraData {
  liveMessageId: string | null;
}

interface RenderMessageInfo {
  item: string;
  extraData?: LiveMessageExtraData;
}

function readLiveMessageId(extraData: unknown): string | null {
  if (
    extraData &&
    typeof extraData === "object" &&
    "liveMessageId" in extraData
  ) {
    const value = (extraData as LiveMessageExtraData).liveMessageId;
    return typeof value === "string" ? value : null;
  }
  return null;
}

function ChatMessagesComponent({
  isStreaming,
  contentPaddingBottom = 100,
}: ChatMessagesProps) {
  const messageIds = useChatStore((state) => state.messageIds);
  const { height, width } = useWindowDimensions();
  const bubbleMaxWidth = useMemo(
    () => Math.max(180, Math.floor(width * USER_BUBBLE_WIDTH_RATIO)),
    [width]
  );
  const drawDistance = useMemo(() => Math.max(600, height * 1.5), [height]);

  const listRef = useRef<FlashListRef<string>>(null);
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const prevLastMessageIdRef = useRef<string | null>(null);
  const pendingScrollFrameRef = useRef<number | null>(null);

  const lastAssistantMessageId = useMemo(
    () => findLastAssistantMessageId(messageIds),
    [messageIds]
  );
  const liveMessageId = isStreaming ? lastAssistantMessageId : null;
  const liveMessageExtraData = useMemo(
    () => ({ liveMessageId }),
    [liveMessageId]
  );
  const hasMessages = messageIds.length > 0;
  const listPaddingBottom = Math.max(96, contentPaddingBottom);
  const currentMessageCount = messageIds.length;
  const currentLastMessageId = messageIds.at(-1) ?? null;

  const scrollToEndIfNearBottom = useCallback(() => {
    if (!isNearBottomRef.current || pendingScrollFrameRef.current !== null) {
      return;
    }

    pendingScrollFrameRef.current = requestAnimationFrame(() => {
      pendingScrollFrameRef.current = null;
      listRef.current?.scrollToEnd({ animated: false });
    });
  }, []);

  useEffect(() => {
    const messageCountChanged =
      currentMessageCount !== prevMessageCountRef.current;
    const lastMessageChanged =
      currentLastMessageId !== prevLastMessageIdRef.current;

    prevMessageCountRef.current = currentMessageCount;
    prevLastMessageIdRef.current = currentLastMessageId;

    if (messageCountChanged || (isStreaming && lastMessageChanged)) {
      scrollToEndIfNearBottom();
    }
  }, [
    currentMessageCount,
    currentLastMessageId,
    isStreaming,
    scrollToEndIfNearBottom,
  ]);

  useEffect(
    () => () => {
      if (pendingScrollFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollFrameRef.current);
      }
    },
    []
  );

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

  const keyExtractor = useCallback((messageId: string) => messageId, []);
  const maintainVisibleContentPosition = useMemo(
    () => ({
      animateAutoScrollToBottom: false,
      autoscrollToBottomThreshold: NEAR_BOTTOM_THRESHOLD,
      startRenderingFromBottom: true,
    }),
    []
  );
  const renderItem = useCallback(
    ({ item, extraData }: RenderMessageInfo) => (
      <MessageListRow
        bubbleMaxWidth={bubbleMaxWidth}
        isLiveMessage={item === readLiveMessageId(extraData)}
        messageId={item}
        onLiveLayout={scrollToEndIfNearBottom}
      />
    ),
    [bubbleMaxWidth, scrollToEndIfNearBottom]
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
    <FlashList
      contentContainerStyle={contentContainerStyle}
      data={messageIds}
      drawDistance={drawDistance}
      extraData={liveMessageExtraData}
      getItemType={getMessageItemType}
      ItemSeparatorComponent={MessageSeparator}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      keyExtractor={keyExtractor}
      ListEmptyComponent={hasMessages ? null : emptyState}
      maintainVisibleContentPosition={maintainVisibleContentPosition}
      onScroll={handleScroll}
      ref={listRef}
      renderItem={renderItem}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    />
  );
}

export const ChatMessages = memo(ChatMessagesComponent);
