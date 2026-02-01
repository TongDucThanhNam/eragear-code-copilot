import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeInUp,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { MessagePart } from "@/store/chat-store";
import { cn_inline } from "./utils";

const AnimatedView = Animated.createAnimatedComponent(View);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type ActivityKind = "tool" | "thinking" | "plan";
type ActivityStatus = "running" | "completed";

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  title: string;
  status: ActivityStatus;
  detail?: string;
};

export type ActivityModel = {
  activities: ActivityItem[];
  detailParts: MessagePart[];
  finalTextPart: Extract<MessagePart, { type: "text" }> | null;
  hasRunningTools: boolean;
  thinkingCount: number;
  toolCount: number;
};

const isToolCall = (
  part: MessagePart
): part is Extract<MessagePart, { type: "tool_call" }> =>
  part.type === "tool_call";

const isToolResult = (
  part: MessagePart
): part is Extract<MessagePart, { type: "tool_result" }> =>
  part.type === "tool_result";

const isReasoning = (
  part: MessagePart
): part is Extract<MessagePart, { type: "reasoning" }> =>
  part.type === "reasoning";

const isPlan = (
  part: MessagePart
): part is Extract<MessagePart, { type: "plan" }> => part.type === "plan";

const isText = (
  part: MessagePart
): part is Extract<MessagePart, { type: "text" }> => part.type === "text";

function summarizeText(text: string, limit = 80) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(limit - 3, 0))}...`;
}

export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

export function buildActivityModel(
  parts: MessagePart[],
  isLiveMessage: boolean
): ActivityModel {
  const toolResults = new Map<string, Extract<MessagePart, { type: "tool_result" }>>();
  const detailParts: MessagePart[] = [];
  const activities: ActivityItem[] = [];

  let toolCount = 0;
  let thinkingCount = 0;

  for (const part of parts) {
    if (isToolResult(part)) {
      toolResults.set(part.toolCallId, part);
    }
  }

  const textParts = parts.filter(isText);
  const finalTextPart = textParts.at(-1) ?? null;

  parts.forEach((part, index) => {
    if (isToolCall(part)) {
      toolCount += 1;
      const result = toolResults.get(part.toolCallId);
      activities.push({
        id: part.toolCallId,
        kind: "tool",
        title: part.name,
        status: result ? "completed" : "running",
        detail: result ? "Completed" : "Running",
      });
      return;
    }

    if (isReasoning(part)) {
      thinkingCount += 1;
      const summary = summarizeText(part.text || "Thinking", 72);
      const isRunning = isLiveMessage && index === parts.length - 1;
      activities.push({
        id: `thinking-${index}`,
        kind: "thinking",
        title: summary || "Thinking",
        status: isRunning ? "running" : "completed",
        detail: isRunning ? "Processing" : "Completed",
      });
      return;
    }

    if (isPlan(part)) {
      const entryCount = part.items.length;
      thinkingCount += entryCount;
      activities.push({
        id: `plan-${index}`,
        kind: "plan",
        title: `Plan updated (${entryCount} steps)`,
        status: "completed",
        detail: "Plan refreshed",
      });
      detailParts.push(part);
      return;
    }

    if (part.type === "diff" || part.type === "terminal") {
      detailParts.push(part);
      return;
    }

    if (isToolResult(part)) {
      detailParts.push(part);
    }
  });

  const hasRunningTools = activities.some(
    (item) => item.kind === "tool" && item.status === "running"
  );

  return {
    activities,
    detailParts,
    finalTextPart,
    hasRunningTools,
    thinkingCount,
    toolCount,
  };
}

export function ActivityRow({
  item,
  isCompact,
}: {
  item: ActivityItem;
  isCompact: boolean;
}) {
  const scale = useSharedValue(1);
  const pulse = useSharedValue(0);
  const isRunning = item.status === "running";
  const prevStatusRef = useRef<ActivityStatus>(item.status);

  useEffect(() => {
    if (isRunning) {
      pulse.value = withRepeat(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      pulse.value = withTiming(0, { duration: 200 });
    }
  }, [isRunning, pulse]);

  useEffect(() => {
    if (prevStatusRef.current === "running" && item.status === "completed") {
      scale.value = withSequence(
        withTiming(1.05, { duration: 140 }),
        withTiming(1, { duration: 160 })
      );
    }
    prevStatusRef.current = item.status;
  }, [item.status, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulse.value * 0.4,
    transform: [{ scale: 1 + pulse.value * 0.06 }],
  }));

  const cursorOpacity = useSharedValue(0);
  useEffect(() => {
    if (item.kind !== "thinking" || !isRunning) {
      cursorOpacity.value = withTiming(0);
      return;
    }
    cursorOpacity.value = withRepeat(
      withTiming(1, { duration: 500 }),
      -1,
      true
    );
  }, [cursorOpacity, isRunning, item.kind]);

  const cursorStyle = useAnimatedStyle(() => ({
    opacity: cursorOpacity.value,
  }));

  const kindLabel =
    item.kind === "tool"
      ? "TOOL"
      : item.kind === "plan"
        ? "PLAN"
        : "THINKING";

  return (
    <AnimatedView
      className={cn_inline(
        "relative overflow-hidden rounded-xl border px-3 py-2",
        isRunning
          ? "border-accent/70 bg-accent/10"
          : "border-transparent bg-surface-foreground/5",
        isCompact ? "mb-2" : "mb-3"
      )}
      style={animatedStyle}
    >
      {isRunning && (
        <AnimatedView
          className="absolute inset-0 rounded-xl bg-accent/10"
          style={pulseStyle}
        />
      )}
      <View className="flex-row items-center justify-between">
        <Text className="text-[10px] font-semibold text-muted-foreground">
          {kindLabel}
        </Text>
        <Text
          className={cn_inline(
            "text-[10px] font-semibold",
            isRunning ? "text-accent" : "text-success"
          )}
        >
          {isRunning ? "RUNNING" : "DONE"}
        </Text>
      </View>
      <View className="mt-1 flex-row items-center gap-2">
        <Text
          className="flex-1 text-foreground text-sm"
          numberOfLines={isCompact ? 1 : 2}
        >
          {item.title}
        </Text>
        {item.kind === "thinking" && isRunning && (
          <AnimatedView
            className="h-4 w-1 rounded-full bg-accent"
            style={cursorStyle}
          />
        )}
      </View>
      {!isCompact && item.detail && (
        <Text className="mt-1 text-[11px] text-muted-foreground">
          {item.detail}
        </Text>
      )}
    </AnimatedView>
  );
}

export function SummaryBar({
  toolCount,
  thinkingCount,
  durationLabel,
  isExpanded,
  onToggle,
}: {
  toolCount: number;
  thinkingCount: number;
  durationLabel: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const pressValue = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressValue.value * 0.02 }],
    backgroundColor: interpolateColor(
      pressValue.value,
      [0, 1],
      ["rgba(255,255,255,0.02)", "rgba(88,166,255,0.12)"]
    ),
  }));

  return (
    <AnimatedPressable
      className="rounded-2xl border border-surface-foreground/10 px-4 py-3"
      onPress={onToggle}
      onPressIn={() => {
        pressValue.value = withTiming(1, { duration: 120 });
      }}
      onPressOut={() => {
        pressValue.value = withTiming(0, { duration: 160 });
      }}
      style={animatedStyle}
    >
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-xs uppercase tracking-wide text-muted-foreground">
            Activity summary
          </Text>
          <Text className="mt-1 text-foreground text-sm">
            {toolCount} tools, {thinkingCount} thinking - {durationLabel}
          </Text>
        </View>
        <Text className="text-accent text-xs">
          {isExpanded ? "Hide" : "Show"}
        </Text>
      </View>
    </AnimatedPressable>
  );
}

export function ExpandedActivityList({
  activities,
  isExpanded,
}: {
  activities: ActivityItem[];
  isExpanded: boolean;
}) {
  const [contentHeight, setContentHeight] = useState(0);
  const height = useSharedValue(0);

  useEffect(() => {
    height.value = withTiming(isExpanded ? contentHeight : 0, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    });
  }, [contentHeight, height, isExpanded]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: height.value,
    opacity: height.value === 0 ? 0 : 1,
  }));

  const renderItems = (compact: boolean) =>
    activities.map((item, index) => (
      <AnimatedView
        entering={
          isExpanded
            ? FadeInUp.delay(index * 40).duration(240)
            : undefined
        }
        key={item.id}
      >
        <ActivityRow isCompact={compact} item={item} />
      </AnimatedView>
    ));

  return (
    <View className="relative mt-3">
      <View
        className="absolute left-0 right-0 opacity-0"
        onLayout={(event) => {
          setContentHeight(event.nativeEvent.layout.height);
        }}
        pointerEvents="none"
      >
        {renderItems(false)}
      </View>
      <AnimatedView className="overflow-hidden" style={animatedStyle}>
        {isExpanded ? renderItems(false) : null}
      </AnimatedView>
    </View>
  );
}
