import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { Spinner } from "heroui-native";
import { memo, useEffect, useRef } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { MessagePart } from "@/store/chat-store";
import { cn_inline } from "./utils";

const AnimatedView = Animated.createAnimatedComponent(View);

// Phase 2: Animation Constants
export const ANIMATION = {
  PULSE: {
    CYCLE_DURATION: 900,
    STOP_DURATION: 200,
    MIN_OPACITY: 0.7,
    MAX_SCALE: 1.06,
    BACKGROUND_OPACITY: 0.4,
  },
  COMPLETION: {
    BUMP_DURATION: 140,
    RETURN_DURATION: 160,
    MAX_SCALE: 1.05,
  },
  ENTRY: {
    DURATION: 200,
    MIN_SCALE: 0.95,
  },
} as const;

type ActivityKind = "tool" | "thinking" | "plan";
type ActivityStatus = "running" | "completed";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  status: ActivityStatus;
  detail?: string;
}

export interface ActivityModel {
  activities: ActivityItem[];
  detailParts: MessagePart[];
  finalTextPart: Extract<MessagePart, { type: "text" }> | null;
  hasRunningTools: boolean;
  thinkingCount: number;
  toolCount: number;
}

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

// Phase 1: ActivityIcon Component
export const ActivityIcon = memo(function ActivityIcon({
  kind,
  size = 16,
}: {
  kind: ActivityKind;
  size?: number;
}) {
  const getIconName = () => {
    switch (kind) {
      case "tool":
        return "settings-outline";
      case "thinking":
        return "bulb-outline";
      case "plan":
        return "list-outline";
      default:
        return "help-circle-outline";
    }
  };

  const getColorClass = () => {
    switch (kind) {
      case "tool":
        return "text-emerald-500";
      case "thinking":
        return "text-sky-500";
      case "plan":
        return "text-amber-500";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <Ionicons
      accessibilityLabel={getIconName()}
      accessible={true}
      className={getColorClass()}
      name={getIconName() as any}
      size={size}
      testID="activity-icon"
    />
  );
});

// Phase 3: ActivityStatusBadge Component
export const ActivityStatusBadge = memo(function ActivityStatusBadge({
  status,
  item,
}: {
  status: ActivityStatus;
  item: ActivityItem;
}) {
  if (status === "running") {
    return (
      <View className="flex-row items-center gap-1">
        <Spinner
          accessibilityLabel="Loading"
          accessible={true}
          color="accent"
          size="sm"
        />
        <Text
          accessibilityLabel="Running"
          accessible={true}
          className="text-[10px] text-muted-foreground"
        >
          Running
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-1">
      <Ionicons
        accessibilityLabel="Completed"
        accessible={true}
        className="text-success"
        name="checkmark-circle"
        size={12}
      />
      <Text
        accessibilityLabel="Done"
        accessible={true}
        className="font-medium text-[10px] text-success"
      >
        Done
      </Text>
    </View>
  );
});

// Phase 3: ActivityLabel Component
export const ActivityLabel = memo(function ActivityLabel({
  title,
  kind,
  numberOfLines,
  size = "sm",
}: {
  title: string;
  kind: ActivityKind;
  numberOfLines?: number;
  size?: "xs" | "sm" | "base";
}) {
  const getTextSizeClass = () => {
    switch (size) {
      case "xs":
        return "text-xs";
      case "sm":
        return "text-sm";
      case "base":
        return "text-base";
      default:
        return "text-sm";
    }
  };

  const getTextColorClass = () => {
    return "text-foreground";
  };

  return (
    <Text
      accessibilityLabel={`${kind === "tool" ? "Tool" : kind === "thinking" ? "Thinking" : "Plan"}: ${title}`}
      accessible={true}
      className={`${getTextSizeClass()} ${getTextColorClass()} flex-1`}
      numberOfLines={numberOfLines}
    >
      {title}
    </Text>
  );
});

export function buildActivityModel(
  parts: MessagePart[],
  isLiveMessage: boolean
): ActivityModel {
  const toolResults = new Map<
    string,
    Extract<MessagePart, { type: "tool_result" }>
  >();
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
  const successGlow = useSharedValue(0);
  const isRunning = item.status === "running";
  const prevStatusRef = useRef<ActivityStatus>(item.status);

  useEffect(() => {
    if (isRunning) {
      pulse.value = withRepeat(
        withTiming(1, {
          duration: ANIMATION.PULSE.CYCLE_DURATION,
          easing: Easing.inOut(Easing.sin),
        }),
        -1,
        true
      );
    } else {
      pulse.value = withTiming(0, { duration: ANIMATION.PULSE.STOP_DURATION });
    }
  }, [isRunning, pulse]);

  useEffect(() => {
    if (prevStatusRef.current === "running" && item.status === "completed") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      successGlow.value = withSequence(
        withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 500, easing: Easing.inOut(Easing.ease) })
      );
      scale.value = withSequence(
        withTiming(ANIMATION.COMPLETION.MAX_SCALE, {
          duration: ANIMATION.COMPLETION.BUMP_DURATION,
          easing: Easing.out(Easing.back(1.5)),
        }),
        withTiming(1, { duration: ANIMATION.COMPLETION.RETURN_DURATION })
      );
    }
    prevStatusRef.current = item.status;
  }, [item.status, scale, successGlow]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulse.value * ANIMATION.PULSE.BACKGROUND_OPACITY,
    transform: [{ scale: 1 + pulse.value * (ANIMATION.PULSE.MAX_SCALE - 1) }],
  }));

  const successGlowStyle = useAnimatedStyle(() => ({
    opacity: successGlow.value * 0.3,
    transform: [{ scale: 1 + successGlow.value * 0.08 }],
  }));

  const getKindDotClass = () => {
    switch (item.kind) {
      case "tool":
        return "bg-emerald-500";
      case "plan":
        return "bg-amber-500";
      default:
        return "bg-sky-500";
    }
  };

  if (isCompact) {
    return (
      <AnimatedView
        className="min-h-11 flex-row items-center gap-2 py-1.5"
        style={animatedStyle}
      >
        <View className="relative h-2 w-2">
          <View className={`h-2 w-2 rounded-full ${getKindDotClass()}`} />
          {isRunning && (
            <AnimatedView
              className="absolute inset-0 bg-accent/30"
              style={pulseStyle}
            />
          )}
          {!isRunning && (
            <AnimatedView
              className="absolute inset-0 rounded-full bg-success/40"
              style={successGlowStyle}
            />
          )}
        </View>
        <ActivityIcon kind={item.kind} size={14} />
        <ActivityLabel
          kind={item.kind}
          numberOfLines={1}
          size="xs"
          title={item.title}
        />
        <ActivityStatusBadge item={item} status={item.status} />
      </AnimatedView>
    );
  }

  return (
    <AnimatedView
      className={cn_inline(
        "relative overflow-hidden border px-3 py-2",
        isRunning
          ? "border-accent/70 bg-accent/10"
          : "border-transparent bg-surface-foreground/5",
        isCompact ? "mb-2" : "mb-3"
      )}
      style={animatedStyle}
    >
      {isRunning && (
        <AnimatedView
          className="absolute inset-0 bg-accent/10"
          style={pulseStyle}
        />
      )}
      {!isRunning && (
        <AnimatedView
          className="absolute inset-0 bg-success/5"
          style={successGlowStyle}
        />
      )}
      <View className="relative z-10 flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-1">
          <View className="flex-row items-center gap-1 bg-surface-foreground/10 px-2 py-0.5">
            <ActivityIcon kind={item.kind} size={12} />
            <Text className="font-medium text-[10px] text-muted-foreground">
              {item.kind === "tool"
                ? "TOOL"
                : item.kind === "plan"
                  ? "PLAN"
                  : "THINKING"}
            </Text>
          </View>
          {isRunning && item.kind === "thinking" && (
            <Spinner color="accent" size="sm" />
          )}
        </View>
        <ActivityStatusBadge item={item} status={item.status} />
      </View>
      <View className="mt-1 flex-row items-center gap-2">
        <ActivityLabel
          kind={item.kind}
          numberOfLines={2}
          size="sm"
          title={item.title}
        />
      </View>
      {!isCompact && item.detail && (
        <Text className="mt-1 text-[11px] text-muted-foreground">
          {item.detail}
        </Text>
      )}
    </AnimatedView>
  );
}
