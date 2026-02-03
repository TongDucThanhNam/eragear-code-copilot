import type { UIMessage } from "@repo/shared";
import { Accordion, Chip } from "heroui-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeInRight,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import {
  ActivityRow,
  buildActivityModel,
  formatDuration,
} from "./agentic-activity";
import { MessageActions } from "./message-actions";
import { MessagePartItem } from "./message-part-item";
import { cn_inline } from "./utils";

const AnimatedView = Animated.createAnimatedComponent(View);

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

// Role-based avatar component
function MessageAvatar({ role }: { role: "user" | "assistant" }) {
  if (role === "user") {
    return (
      <View className="h-7 w-7 items-center justify-center rounded-full bg-accent">
        <Text className="font-medium text-white text-xs">U</Text>
      </View>
    );
  }

  return (
    <View className="h-7 w-7 items-center justify-center rounded-full bg-surface-foreground/10">
      <Text className="font-bold text-foreground text-xs">AI</Text>
    </View>
  );
}

// Avatar wrapper to avoid aria role issues
type AvatarType = "user" | "assistant";
function AvatarWrapper({ type }: { type: AvatarType }) {
  return <MessageAvatar role={type} />;
}
const LIVE_IDLE_MS = 1200;
const LIVE_FADE_MS = 500;
const SUMMARY_DELAY_MS = 150;
const SUMMARY_ENTER_MS = 700;
const FINAL_TEXT_DELAY_MS = SUMMARY_DELAY_MS + SUMMARY_ENTER_MS + 120;

type DisplayMode = "live" | "transitioning" | "collapsed";
interface MessageItemProps {
  message: UIMessage;
  terminalOutputs: Map<string, string>;
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
  terminalOutputs,
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

  const liveOpacity = useSharedValue(displayMode === "live" ? 1 : 0);
  const liveScale = useSharedValue(1);
  const liveTranslate = useSharedValue(0);
  const summaryOpacity = useSharedValue(displayMode === "collapsed" ? 1 : 0);
  const summaryScale = useSharedValue(displayMode === "collapsed" ? 1 : 0.9);
  const summaryTranslate = useSharedValue(displayMode === "collapsed" ? 0 : 12);

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
      setDisplayMode((mode) => (mode === "live" ? "transitioning" : mode));
    }, LIVE_IDLE_MS);
    return () => clearTimeout(timeout);
  }, [hasActivities, hasRunningTools]);

  useEffect(() => {
    if (displayMode === "transitioning") {
      const timeout = setTimeout(() => {
        setDisplayMode("collapsed");
      }, LIVE_FADE_MS + 50);
      return () => clearTimeout(timeout);
    }
    if (displayMode === "collapsed") {
      const first = firstActivityAtRef.current;
      const last = lastActivityAtRef.current;
      if (first !== null && last !== null) {
        setDurationMs(Math.max(0, last - first));
      }
    }
    return undefined;
  }, [displayMode]);

  useEffect(() => {
    if (displayMode === "live") {
      liveOpacity.value = withTiming(1, { duration: 200 });
      liveScale.value = withTiming(1, { duration: 200 });
      liveTranslate.value = withTiming(0, { duration: 200 });
      return;
    }
    if (displayMode === "transitioning") {
      liveOpacity.value = withTiming(0, { duration: LIVE_FADE_MS });
      liveScale.value = withTiming(0.95, { duration: LIVE_FADE_MS });
      liveTranslate.value = withTiming(-8, { duration: LIVE_FADE_MS });
      return;
    }
    liveOpacity.value = withTiming(0, { duration: 150 });
  }, [displayMode, liveOpacity, liveScale, liveTranslate]);

  useEffect(() => {
    if (displayMode === "transitioning") {
      summaryOpacity.value = 0;
      summaryScale.value = 0.9;
      summaryTranslate.value = 12;
      summaryOpacity.value = withDelay(
        SUMMARY_DELAY_MS,
        withTiming(1, { duration: SUMMARY_ENTER_MS })
      );
      summaryScale.value = withDelay(
        SUMMARY_DELAY_MS,
        withTiming(1, { duration: SUMMARY_ENTER_MS })
      );
      summaryTranslate.value = withDelay(
        SUMMARY_DELAY_MS,
        withTiming(0, { duration: SUMMARY_ENTER_MS })
      );
      return;
    }
    if (displayMode === "collapsed") {
      summaryOpacity.value = withTiming(1, { duration: 180 });
      summaryScale.value = withTiming(1, { duration: 180 });
      summaryTranslate.value = withTiming(0, { duration: 180 });
      return;
    }
    summaryOpacity.value = withTiming(0, { duration: 150 });
    summaryScale.value = withTiming(0.98, { duration: 150 });
    summaryTranslate.value = withTiming(8, { duration: 150 });
  }, [displayMode, summaryOpacity, summaryScale, summaryTranslate]);

  const liveStyle = useAnimatedStyle(() => ({
    opacity: liveOpacity.value,
    transform: [
      { translateY: liveTranslate.value },
      { scale: liveScale.value },
    ],
  }));
  const summaryStyle = useAnimatedStyle(() => ({
    opacity: summaryOpacity.value,
    transform: [
      { translateY: summaryTranslate.value },
      { scale: summaryScale.value },
    ],
  }));

  const showLive = displayMode !== "collapsed";
  const visibleActivities =
    displayMode === "live"
      ? activities.slice(-MAX_VISIBLE_ACTIVITIES)
      : activities;

  useEffect(() => {
    if (!showLive) {
      return;
    }
    liveScrollRef.current?.scrollToEnd({ animated: true });
  }, [showLive]);

  if (!hasActivities || isUser) {
    const isUserMessage = isUser;
    return (
      <AnimatedView className="w-full" entering={FadeInRight.duration(300)}>
        {/* Message header with avatar and timestamp */}
        <View className="mb-1.5 flex-row items-center gap-2">
          {!isUserMessage && <AvatarWrapper type="assistant" />}
          <Text className="text-[10px] text-muted-foreground">
            {isUserMessage ? "You" : "Assistant"}
          </Text>
          <Text className="text-[10px] text-muted-foreground/50">·</Text>
          <Text className="text-[10px] text-muted-foreground/70">
            {formatMessageTime(getMessageTimestamp(message))}
          </Text>
          {isUserMessage && <AvatarWrapper type="user" />}
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
                terminalOutputs={terminalOutputs}
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
      </AnimatedView>
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
    <AnimatedView className="w-full" entering={FadeInRight.duration(300)}>
      {/* Message header with avatar and timestamp */}
      <View className="mb-1.5 flex-row items-center gap-2">
        <AvatarWrapper type="assistant" />
        <Text className="text-[10px] text-muted-foreground">Assistant</Text>
        <Text className="text-[10px] text-muted-foreground/50">·</Text>
        <Text className="text-[10px] text-muted-foreground/70">
          {formatMessageTime(getMessageTimestamp(message))}
        </Text>
        {/* Streaming indicator */}
        {isLiveMessage && (
          <View className="flex-row items-center gap-1">
            <Animated.View
              className="h-1.5 w-1.5 rounded-full bg-accent"
              entering={FadeIn}
              exiting={FadeOut}
            />
            <Text className="text-[10px] text-accent">Thinking...</Text>
          </View>
        )}
      </View>

      <View className="w-full">
        {showLive && (
          <AnimatedView style={liveStyle}>
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
          </AnimatedView>
        )}

        {/* Show Summary */}
        {showSummary && (
          <AnimatedView
            exiting={FadeOut.duration(200)}
            key={`summary-${message.id}`}
            style={summaryStyle}
          >
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
                          terminalOutputs={terminalOutputs}
                        />
                      ))}
                    </View>
                  )}
                </Accordion.Content>
              </Accordion.Item>
            </Accordion>
          </AnimatedView>
        )}

        {displayMode === "collapsed" && finalTextPart && (
          <AnimatedView
            entering={FadeIn.delay(FINAL_TEXT_DELAY_MS).duration(300)}
          >
            <View className="mt-2">
              <MessagePartItem
                part={finalTextPart}
                terminalOutputs={terminalOutputs}
              />
            </View>
          </AnimatedView>
        )}
        {showActions && (
          <MessageActions className="self-start" text={messageText} />
        )}
      </View>
    </AnimatedView>
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
  // terminalOutputs is a Map, reference comparison is fine
  return true;
}

export const MemoizedMessageItem = React.memo(MessageItem, propsAreEqual);
