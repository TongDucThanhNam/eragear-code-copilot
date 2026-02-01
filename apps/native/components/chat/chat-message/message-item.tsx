import { Chip } from "heroui-native";
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
import type { ChatMessage } from "@/store/chat-store";
import {
  ActivityRow,
  buildActivityModel,
  ExpandedActivityList,
  formatDuration,
  SummaryBar,
} from "./agentic-activity";
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
  message: ChatMessage;
  terminalOutputs: Map<string, string>;
  isLiveMessage: boolean;
}

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
  const [isExpanded, setIsExpanded] = useState(false);
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
    setIsExpanded(false);
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
      setIsExpanded(false);
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

  useEffect(() => {
    if (!showLive) {
      return;
    }
    liveScrollRef.current?.scrollToEnd({ animated: true });
  }, [showLive, visibleActivities.length]);

  if (!hasActivities || isUser) {
    const isUserMessage = isUser;
    return (
      <View
        className={cn_inline("mb-4", isUserMessage ? "self-end" : "self-start")}
      >
        <View
          className={cn_inline(
            "rounded-2xl p-3",
            isUserMessage ? "max-w-[85%] bg-accent" : "w-full bg-surface"
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
      </View>
    );
  }

  const visibleActivities =
    displayMode === "live"
      ? activities.slice(-MAX_VISIBLE_ACTIVITIES)
      : activities;
  const hiddenCount = Math.max(0, activities.length - visibleActivities.length);

  const showLive = displayMode !== "collapsed";
  const showSummary = displayMode !== "live";
  const durationLabel = formatDuration(
    displayMode === "collapsed"
      ? durationMs
      : Date.now() - (firstActivityAtRef.current ?? Date.now())
  );

  return (
    <View className="mb-4 w-full">
      <View className="w-full">
        {showLive && (
          <AnimatedView style={liveStyle}>
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-muted-foreground text-xs uppercase tracking-wide">
                Live activity
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
                <ActivityRow isCompact item={item} key={item.id} />
              ))}
              {hiddenCount > 0 && (
                <Text className="mt-1 text-muted-foreground text-xs">
                  +{hiddenCount} activities hidden
                </Text>
              )}
            </ScrollView>
          </AnimatedView>
        )}

        {showSummary && (
          <AnimatedView
            exiting={FadeOut.duration(200)}
            key={`summary-${message.id}`}
            style={summaryStyle}
          >
            <SummaryBar
              durationLabel={durationLabel}
              isExpanded={isExpanded}
              onToggle={() => {
                setIsExpanded((prev) => !prev);
              }}
              thinkingCount={thinkingCount}
              toolCount={toolCount}
            />
            <ExpandedActivityList
              activities={activities}
              isExpanded={isExpanded}
            />
            {detailParts.length > 0 && isExpanded && (
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
          </AnimatedView>
        )}

        {displayMode === "collapsed" && finalTextPart && (
          <AnimatedView
            entering={FadeIn.delay(FINAL_TEXT_DELAY_MS).duration(300)}
          >
            <View className="mt-3">
              <MessagePartItem
                part={finalTextPart}
                terminalOutputs={terminalOutputs}
              />
            </View>
          </AnimatedView>
        )}
      </View>
    </View>
  );
}
