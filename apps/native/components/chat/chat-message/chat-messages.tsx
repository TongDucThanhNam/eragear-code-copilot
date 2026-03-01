import { FlashList } from "@shopify/flash-list";
import { memo, useCallback, useMemo, useRef } from "react";
import type { ScrollViewProps } from "react-native";
import { Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useChatStore } from "@/store/chat-store";
import { MemoizedMessageItemContainer } from "./message-item";

// Helper to get timestamp from message metadata
function getMessageTimestamp(message: {
  metadata?: unknown;
  createdAt?: number;
}): number {
  if (message.metadata && typeof message.metadata === "object") {
    const meta = message.metadata as Record<string, unknown>;
    if (typeof meta.timestamp === "number") {
      return meta.timestamp;
    }
  }
  if (typeof message.createdAt === "number") {
    return message.createdAt;
  }
  return 0;
}

// Separator component for grouping messages
const MessageSeparator = memo(function MessageSeparator({
  leadingItem,
  trailingItem,
}: {
  leadingItem: string;
  trailingItem: string;
}) {
  const { messagesById } = useChatStore.getState();
  const prevMessage = messagesById.get(leadingItem);
  const currentMessage = messagesById.get(trailingItem);

  if (!prevMessage || !currentMessage) {
    return <View className="h-4" />;
  }

  // Show separator when roles change or after a significant gap
  const isRoleChange = prevMessage.role !== currentMessage.role;
  const prevTime = getMessageTimestamp(prevMessage);
  const currTime = getMessageTimestamp(currentMessage);
  const timeGap = currTime - prevTime;
  const showTimeGap = prevTime > 0 && currTime > 0 && timeGap > 5 * 60 * 1000; // 5 minutes

  if (isRoleChange) {
    return (
      <View className="h-6 items-center justify-center">
        <View className="h-px w-12 bg-divider" />
      </View>
    );
  }

  if (showTimeGap) {
    return (
      <View className="h-8 items-center justify-center">
        <View className="rounded-full bg-surface-foreground/5 px-3 py-1">
          <Text className="text-[10px] text-muted-foreground">
            {new Date(currTime).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </View>
      </View>
    );
  }

  return <View className="h-3" />;
});

interface ChatMessagesProps {
  messageIds: string[];
  isStreaming: boolean;
  contentPaddingBottom?: number;
  keyboardBottomOffset?: number;
}

function ChatMessagesComponent({
  messageIds,
  isStreaming,
  contentPaddingBottom = 100,
  keyboardBottomOffset = 0,
}: ChatMessagesProps) {
  const hasMessages = messageIds.length > 0;

  // Cache the last assistant message ID to avoid recalculating on every render
  const lastAssistantMessageIdRef = useRef<string | null>(null);
  const lastMessageSignatureRef = useRef<string>("");

  // Only recalculate when message order changes
  const lastId = messageIds[messageIds.length - 1] ?? "none";
  const nextSignature = `${messageIds.length}:${lastId}`;
  if (nextSignature !== lastMessageSignatureRef.current) {
    lastAssistantMessageIdRef.current = null;
    const { messagesById } = useChatStore.getState();
    for (let i = messageIds.length - 1; i >= 0; i -= 1) {
      const message = messagesById.get(messageIds[i] ?? "");
      if (message?.role === "assistant") {
        lastAssistantMessageIdRef.current = message.id;
        break;
      }
    }
    lastMessageSignatureRef.current = nextSignature;
  }

  const lastAssistantMessageId = lastAssistantMessageIdRef.current;
  const listPaddingBottom = Math.max(96, contentPaddingBottom);
  const renderScrollComponent = useCallback(
    (props: ScrollViewProps) => (
      <KeyboardAwareScrollView {...props} bottomOffset={keyboardBottomOffset} />
    ),
    [keyboardBottomOffset]
  );
  const keyExtractor = useCallback((item: string) => item, []);
  const getItemType = useCallback((id: string) => {
    const message = useChatStore.getState().messagesById.get(id);
    return message?.role ?? "assistant";
  }, []);
  const renderItem = useCallback(
    ({ item, index }: { item: string; index: number }) => {
      const nextId = messageIds[index + 1];
      const nextMessage = nextId
        ? useChatStore.getState().messagesById.get(nextId)
        : undefined;
      const isContinuedByAssistant = nextMessage?.role === "assistant";

      return (
        <MemoizedMessageItemContainer
          isLiveMessage={isStreaming && item === lastAssistantMessageId}
          isContinuedByAssistant={isContinuedByAssistant}
          messageId={item}
        />
      );
    },
    [isStreaming, lastAssistantMessageId, messageIds]
  );

  const emptyState = useMemo(
    () => (
      <View className="flex-1 items-center justify-center px-8">
        <View className="mb-6 h-20 w-20 items-center justify-center rounded-full bg-surface-foreground/5">
          <View className="h-12 w-12 rounded-full bg-accent/20" />
        </View>

        <Text className="font-semibold text-foreground text-lg">
          Start a conversation
        </Text>
        <Text className="mt-2 text-center text-muted-foreground text-sm">
          Send a message to start chatting with your AI assistant
        </Text>

        <View className="mt-8 w-full max-w-xs">
          <Text className="mb-3 text-center text-muted-foreground text-xs uppercase tracking-wide">
            Try asking
          </Text>
          <View className="flex-col gap-2">
            <View className="rounded-lg bg-surface-foreground/5 px-4 py-3">
              <Text className="text-center text-muted-foreground text-sm">
                "Help me write a React component"
              </Text>
            </View>
            <View className="rounded-lg bg-surface-foreground/5 px-4 py-3">
              <Text className="text-center text-muted-foreground text-sm">
                "Debug this code for me"
              </Text>
            </View>
            <View className="rounded-lg bg-surface-foreground/5 px-4 py-3">
              <Text className="text-center text-muted-foreground text-sm">
                "Explain how this API works"
              </Text>
            </View>
          </View>
        </View>
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
  const maintainVisibleContentPosition = useMemo(
    () => ({
      autoscrollToBottomThreshold: 120,
      animateAutoScrollToBottom: false,
    }),
    []
  );

  return (
    <FlashList
      contentContainerStyle={contentContainerStyle}
      data={messageIds}
      removeClippedSubviews
      getItemType={getItemType}
      ItemSeparatorComponent={MessageSeparator}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      keyExtractor={keyExtractor}
      ListEmptyComponent={hasMessages ? null : emptyState}
      maintainVisibleContentPosition={maintainVisibleContentPosition}
      renderItem={renderItem}
      renderScrollComponent={renderScrollComponent}
    />
  );
}

export const ChatMessages = memo(ChatMessagesComponent);
