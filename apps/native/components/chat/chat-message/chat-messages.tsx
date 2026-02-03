import type { UIMessage } from "@repo/shared";
import { FlashList } from "@shopify/flash-list";
import React, { useRef } from "react";
import type { ScrollViewProps } from "react-native";
import { Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { MemoizedMessageItem } from "./message-item";

// Helper to get timestamp from message metadata
function getMessageTimestamp(message: UIMessage): number {
  if (message.metadata && typeof message.metadata === "object") {
    const meta = message.metadata as Record<string, unknown>;
    if (typeof meta.timestamp === "number") {
      return meta.timestamp;
    }
  }
  return Date.now();
}

// Separator component for grouping messages
function MessageSeparator({
  index,
  messages,
}: {
  index: number;
  messages: UIMessage[];
}) {
  const currentMessage = messages[index];
  const prevMessage = index > 0 ? messages[index - 1] : null;

  if (!(prevMessage && currentMessage)) {
    return <View className="h-4" />;
  }

  // Show separator when roles change or after a significant gap
  const isRoleChange = prevMessage.role !== currentMessage.role;
  const prevTime = getMessageTimestamp(prevMessage);
  const currTime = getMessageTimestamp(currentMessage);
  const timeGap = currTime - prevTime;
  const showTimeGap = timeGap > 5 * 60 * 1000; // 5 minutes

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
}

interface ChatMessagesProps {
  messages: UIMessage[];
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

  // Cache the last assistant message ID to avoid recalculating on every render
  const lastAssistantMessageIdRef = useRef<string | null>(null);
  const lastMessageLengthRef = useRef(messages.length);

  // Only recalculate when messages array changes
  if (messages.length !== lastMessageLengthRef.current) {
    lastAssistantMessageIdRef.current = null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") {
        lastAssistantMessageIdRef.current = messages[i]?.id ?? null;
        break;
      }
    }
    lastMessageLengthRef.current = messages.length;
  }

  const lastAssistantMessageId = lastAssistantMessageIdRef.current;
  const listPaddingBottom = Math.max(96, contentPaddingBottom);
  const renderScrollComponent = (props: ScrollViewProps) => (
    <KeyboardAwareScrollView {...props} bottomOffset={keyboardBottomOffset} />
  );

  // Animated pulse for empty state
  const pulseAnim = useSharedValue(1);
  const animatedPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseAnim.value }],
  }));

  React.useEffect(() => {
    pulseAnim.value = withRepeat(
      withTiming(1.05, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [pulseAnim]);

  const renderEmptyState = () => (
    <View className="flex-1 items-center justify-center px-8">
      {/* Animated icon placeholder */}
      <Animated.View
        className="mb-6 h-20 w-20 items-center justify-center rounded-full bg-surface-foreground/5"
        style={animatedPulseStyle}
      >
        <View className="h-12 w-12 rounded-full bg-accent/20" />
      </Animated.View>

      <Text className="font-semibold text-foreground text-lg">
        Start a conversation
      </Text>
      <Text className="mt-2 text-center text-muted-foreground text-sm">
        Send a message to start chatting with your AI assistant
      </Text>

      {/* Quick start suggestions */}
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
      ItemSeparatorComponent={(props) => (
        <MessageSeparator index={props.index} messages={messages} />
      )}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item, index) => item.id ?? `${item.role}-${index}`}
      ListEmptyComponent={hasMessages ? null : renderEmptyState}
      renderItem={({ item, index }) => (
        <MemoizedMessageItem
          isFirstMessage={index === 0}
          isLastMessage={index === messages.length - 1}
          isLiveMessage={isStreaming && item.id === lastAssistantMessageId}
          message={item}
          terminalOutputs={terminalOutputs}
        />
      )}
      renderScrollComponent={renderScrollComponent}
    />
  );
}
