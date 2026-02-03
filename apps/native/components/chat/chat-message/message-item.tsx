import type { UIMessage } from "@repo/shared";
import { Accordion, Chip } from "heroui-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useChatStore } from "@/store/chat-store";
import {
  ActivityRow,
  buildActivityModel,
  formatDuration,
} from "./agentic-activity";
import { MessageActions } from "./message-actions";
import { MessagePartItem } from "./message-part-item";
import { cn_inline } from "./utils";

const MAX_VISIBLE_ACTIVITIES = 8;

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

// Get timestamp from message metadata or use current time
function getMessageTimestamp(message: UIMessage): number {
  if (message.metadata && typeof message.metadata === "object") {
    const meta = message.metadata as Record<string, unknown>;
    if (typeof meta.timestamp === "number") {
      return meta.timestamp;
    }
  }
  return Date.now();
}

const LIVE_IDLE_MS = 1200;

type DisplayMode = "live" | "collapsed";
interface MessageItemProps {
  message: UIMessage;
  isLiveMessage: boolean;
  isFirstMessage?: boolean;
  isLastMessage?: boolean;
}

interface MessageItemContainerProps {
  messageId: string;
  isLiveMessage: boolean;
  isFirstMessage?: boolean;
  isLastMessage?: boolean;
}

const extractMessageText = (parts: UIMessage["parts"]) =>
  parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n\n");

export function MessageItem({
  message,
  isLiveMessage,
}: MessageItemProps) {
  const isUser = message.role === "user";

  // Use ref to track if this is a live message without causing re-renders
  const isLiveMessageRef = useRef(isLiveMessage);
  useEffect(() => {
    isLiveMessageRef.current = isLiveMessage;
  }, [isLiveMessage]);

  const {
    activities,
    detailParts,
    finalTextPart,
    hasRunningTools,
    thinkingCount,
    toolCount,
  } = useMemo(
    () => buildActivityModel(message.parts, isLiveMessage),
    [message.parts, isLiveMessage]
  );

  const hasActivities = activities.length > 0 && message.role === "assistant";
  const messageText = useMemo(
    () => extractMessageText(message.parts),
    [message.parts]
  );
  const showActions = message.role === "assistant" && messageText.length > 0;

  const [displayMode, setDisplayMode] = useState<DisplayMode>(() =>
    isLiveMessage && hasActivities ? "live" : "collapsed"
  );
  const [durationMs, setDurationMs] = useState(0);
  const liveScrollRef = useRef<ScrollView | null>(null);

  const firstActivityAtRef = useRef<number | null>(null);
  const lastActivityAtRef = useRef<number | null>(null);

  useEffect(() => {
    firstActivityAtRef.current = null;
    lastActivityAtRef.current = null;
    setDurationMs(0);
    if (hasActivities && isLiveMessage) {
      setDisplayMode("live");
    } else if (hasActivities) {
      setDisplayMode("collapsed");
    }
  }, [hasActivities, isLiveMessage]);

  useEffect(() => {
    if (!hasActivities) {
      return;
    }
    const now = Date.now();
    if (!firstActivityAtRef.current) {
      firstActivityAtRef.current = now;
    }
    lastActivityAtRef.current = now;
    if (isLiveMessageRef.current) {
      setDisplayMode("live");
    }
  }, [hasActivities]);

  useEffect(() => {
    if (!hasActivities) {
      return;
    }
    if (hasRunningTools) {
      return;
    }
    if (!isLiveMessageRef.current) {
      setDisplayMode("collapsed");
      return;
    }
    const timeout = setTimeout(() => {
      setDisplayMode("collapsed");
    }, LIVE_IDLE_MS);
    return () => clearTimeout(timeout);
  }, [hasActivities, hasRunningTools]);

  useEffect(() => {
    if (displayMode === "collapsed") {
      const first = firstActivityAtRef.current;
      const last = lastActivityAtRef.current;
      if (first !== null && last !== null) {
        setDurationMs(Math.max(0, last - first));
      }
    }
    return undefined;
  }, [displayMode]);

  const showLive = displayMode !== "collapsed";
  const visibleActivities =
    displayMode === "live"
      ? activities.slice(-MAX_VISIBLE_ACTIVITIES)
      : activities;

  useEffect(() => {
    if (!showLive) {
      return;
    }
    liveScrollRef.current?.scrollToEnd({ animated: false });
  }, [showLive]);

  if (!hasActivities || isUser) {
    const isUserMessage = isUser;
    return (
      <View className="w-full">
        {/* Message header with avatar and timestamp */}
        <View className="mb-1.5 flex-row items-center gap-2">
          <Text className="text-[10px] text-muted-foreground">
            {isUserMessage ? "You" : "Assistant"}
          </Text>
          <Text className="text-[10px] text-muted-foreground/50">·</Text>
          <Text className="text-[10px] text-muted-foreground/70">
            {formatMessageTime(getMessageTimestamp(message))}
          </Text>
        </View>

        <View
          className={cn_inline(
            "flex-col gap-1.5",
            isUserMessage ? "items-end" : "items-start"
          )}
        >
          <View
            className={cn_inline(
              "flex-col gap-1.5 rounded-2xl px-4 py-3",
              isUserMessage
                ? "max-w-[82%] self-end bg-accent text-white"
                : "max-w-[88%] self-start bg-surface-foreground/5 text-foreground"
            )}
          >
            {message.parts.map((part, index) => (
              <MessagePartItem
                key={`${part.type}-${index}`}
                part={part}
              />
            ))}
          </View>
          {showActions && (
            <MessageActions
              className={cn_inline(isUserMessage ? "self-end" : "self-start")}
              text={messageText}
            />
          )}
        </View>
      </View>
    );
  }

  const hiddenCount = Math.max(0, activities.length - visibleActivities.length);

  const showSummary = displayMode !== "live";
  const durationLabel = formatDuration(
    displayMode === "collapsed"
      ? durationMs
      : Date.now() - (firstActivityAtRef.current ?? Date.now())
  );
  const summaryLabel = `${toolCount} tools, ${thinkingCount} thinking - ${durationLabel}`;

  return (
    <View className="w-full">
      {/* Message header with timestamp */}
      <View className="mb-1.5 flex-row items-center gap-2">
        <Text className="text-[10px] text-muted-foreground">Assistant</Text>
        <Text className="text-[10px] text-muted-foreground/50">·</Text>
        <Text className="text-[10px] text-muted-foreground/70">
          {formatMessageTime(getMessageTimestamp(message))}
        </Text>
        {/* Streaming indicator */}
        {isLiveMessage && (
          <View className="flex-row items-center gap-1">
            <View className="h-1.5 w-1.5 rounded-full bg-accent" />
            <Text className="text-[10px] text-accent">Thinking...</Text>
          </View>
        )}
      </View>

      <View className="w-full">
        {showLive && (
          <View>
            <View className="mb-1 flex-row items-center justify-between">
              <Text className="text-[11px] text-muted-foreground lowercase tracking-normal">
                live activity
              </Text>
              <Chip color="accent" size="sm" variant="soft">
                {activities.length}
              </Chip>
            </View>
            <ScrollView
              className="max-h-44"
              ref={liveScrollRef}
              showsVerticalScrollIndicator={false}
            >
              {visibleActivities.map((item, index) => (
                <ActivityRow
                  isCompact
                  item={item}
                  key={`${item.id}-${item.status}-${index}`}
                />
              ))}
              {hiddenCount > 0 && (
                <Text className="mt-1 text-muted-foreground text-xs">
                  +{hiddenCount} activities hidden
                </Text>
              )}
            </ScrollView>
          </View>
        )}

        {/* Show Summary */}
        {showSummary && (
          <View key={`summary-${message.id}`}>
            <Accordion variant="default">
              <Accordion.Item value={`summary-${message.id}`}>
                <Accordion.Trigger className="min-h-7 px-1.5 py-1">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 pr-2">
                      <Text
                        className="text-[11px] text-muted-foreground"
                        numberOfLines={1}
                      >
                        activity · {summaryLabel}
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-2">
                      <Text className="text-[10px] text-muted-foreground">
                        {activities.length}
                      </Text>
                      <Accordion.Indicator />
                    </View>
                  </View>
                </Accordion.Trigger>
                <Accordion.Content className="px-1.5 pt-0 pb-1">
                  <View className="flex-col gap-1">
                    {activities.map((item, index) => (
                      <View
                        className="py-0.5"
                        key={`${item.id}-${item.status}-${index}`}
                      >
                        <ActivityRow isCompact item={item} />
                      </View>
                    ))}
                  </View>
                  {detailParts.length > 0 && (
                    <View className="mt-3">
                        {detailParts.map((part, index) => (
                          <MessagePartItem
                            key={`detail-${part.type}-${index}`}
                            part={part}
                          />
                        ))}
                    </View>
                  )}
                </Accordion.Content>
              </Accordion.Item>
            </Accordion>
          </View>
        )}

        {displayMode === "collapsed" && finalTextPart && (
          <View className="mt-2">
            <MessagePartItem
              part={finalTextPart}
            />
          </View>
        )}
        {showActions && (
          <MessageActions className="self-start" text={messageText} />
        )}
      </View>
    </View>
  );
}

function MessageItemContainer({
  messageId,
  isLiveMessage,
  isFirstMessage,
  isLastMessage,
}: MessageItemContainerProps) {
  const message = useChatStore((state) => state.messagesById.get(messageId));
  if (!message) {
    return null;
  }
  return (
    <MemoizedMessageItem
      isFirstMessage={isFirstMessage}
      isLastMessage={isLastMessage}
      isLiveMessage={isLiveMessage}
      message={message}
    />
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
  if (prev.isFirstMessage !== next.isFirstMessage) {
    return false;
  }
  if (prev.isLastMessage !== next.isLastMessage) {
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
  if (prev.isFirstMessage !== next.isFirstMessage) {
    return false;
  }
  if (prev.isLastMessage !== next.isLastMessage) {
    return false;
  }
  return true;
}

export const MemoizedMessageItemContainer = React.memo(
  MessageItemContainer,
  containerPropsAreEqual
);
