import { Chip, Spinner } from "heroui-native";
import { useEffect, useRef } from "react";
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

  const kindLabel =
    item.kind === "tool" ? "TOOL" : item.kind === "plan" ? "PLAN" : "THINKING";

  const getKindColor = () => {
    switch (item.kind) {
      case "tool":
        return "secondary";
      case "plan":
        return "tertiary";
      default:
        return "primary";
    }
  };

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
        className="flex-row items-center gap-2 py-1.5"
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
        </View>
        <Text className="text-[10px] text-muted-foreground uppercase tracking-wide">
          {kindLabel}
        </Text>
        <Text className="flex-1 text-foreground text-xs" numberOfLines={1}>
          {item.title}
        </Text>
        <Text className="text-[10px] text-muted-foreground">
          {isRunning ? "Running" : "Done"}
        </Text>
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
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1">
          <Chip color={getKindColor()} size="sm" variant="soft">
            {kindLabel}
          </Chip>
          {isRunning && item.kind === "thinking" && (
            <Spinner color="accent" size="sm" />
          )}
        </View>
        <Chip color={isRunning ? "accent" : "success"} size="sm" variant="soft">
          {isRunning ? "RUNNING" : "DONE"}
        </Chip>
      </View>
      <View className="mt-1 flex-row items-center gap-2">
        <Text
          className="flex-1 text-foreground text-sm"
          numberOfLines={isCompact ? 1 : 2}
        >
          {item.title}
        </Text>
      </View>
      {!isCompact && item.detail && (
        <Text className="mt-1 text-[11px] text-muted-foreground">
          {item.detail}
        </Text>
      )}
    </AnimatedView>
  );
}
