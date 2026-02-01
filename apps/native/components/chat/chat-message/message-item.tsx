import { Accordion, Chip } from "heroui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import type { UIMessage } from "@repo/shared";
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

  const {
    activities,
    detailParts,
    finalTextPart,
    hasRunningTools,
    thinkingCount,
    toolCount,
  } = useMemo(
    () => buildActivityModel(message.parts, isLiveMessage),
    [isLiveMessage, message.parts]
  );

  const hasActivities = activities.length > 0 && message.role === "assistant";
  const messageText = useMemo(
    () => extractMessageText(message.parts),
    [message.parts]
  );
  const showActions = message.role === "assistant" && messageText.length > 0;
  const activityKey = useMemo(
    () =>
      activities
        .map((item) => `${item.id}:${item.status}:${item.title}`)
        .join("|"),
    [activities]
  );

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
  }, [hasActivities, isLiveMessage, message.id]);

  useEffect(() => {
    if (!hasActivities) {
      return;
    }
    const now = Date.now();
    if (!firstActivityAtRef.current) {
      firstActivityAtRef.current = now;
    }
    lastActivityAtRef.current = now;
    if (isLiveMessage) {
      setDisplayMode("live");
    }
  }, [activityKey, hasActivities, isLiveMessage, message.parts]);

  useEffect(() => {
    if (!hasActivities) {
      return;
    }
    if (hasRunningTools) {
      return;
    }
    if (!isLiveMessage) {
      setDisplayMode("collapsed");
      return;
    }
    const timeout = setTimeout(() => {
      setDisplayMode((mode) => (mode === "live" ? "transitioning" : mode));
    }, LIVE_IDLE_MS);
    return () => clearTimeout(timeout);
  }, [activityKey, hasActivities, hasRunningTools, isLiveMessage]);

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
  }, [showLive, visibleActivities.length]);

  if (!hasActivities || isUser) {
    const isUserMessage = isUser;
    return (
      <View className="w-full">
        <View
          className={cn_inline(
            "flex-col gap-1.5",
            isUserMessage ? "items-end" : "items-start"
          )}
        >
          <View
            className={cn_inline(
              "flex-col gap-1.5",
              isUserMessage
                ? "max-w-[82%] self-end text-foreground"
                : "max-w-[88%] self-start text-muted-foreground opacity-90"
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
    </View>
  );
}
