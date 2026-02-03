import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { Spinner } from "heroui-native";
import { memo, useEffect, useRef } from "react";
import { Text, View } from "react-native";
import type { ToolUIPart, UIMessagePart } from "@repo/shared";
import { cn_inline } from "./utils";

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
  detailParts: UIMessagePart[];
  finalTextPart: Extract<UIMessagePart, { type: "text" }> | null;
  hasRunningTools: boolean;
  thinkingCount: number;
  toolCount: number;
}

const isToolPart = (part: UIMessagePart): part is ToolUIPart =>
  part.type.startsWith("tool-");

const isReasoning = (
  part: UIMessagePart
): part is Extract<UIMessagePart, { type: "reasoning" }> =>
  part.type === "reasoning";

const isText = (
  part: UIMessagePart
): part is Extract<UIMessagePart, { type: "text" }> => part.type === "text";

const isPlanOutput = (
  output: unknown
): output is { entries: Array<{ content: string; status: string }> } =>
  typeof output === "object" &&
  output !== null &&
  Array.isArray((output as { entries?: unknown }).entries);

const isToolRunning = (tool: ToolUIPart) =>
  tool.state === "input-streaming" ||
  tool.state === "input-available" ||
  tool.state === "approval-requested" ||
  tool.state === "approval-responded";

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
  parts: UIMessagePart[],
  isLiveMessage: boolean
): ActivityModel {
  const detailParts: UIMessagePart[] = [];
  const activities: ActivityItem[] = [];

  let toolCount = 0;
  let thinkingCount = 0;

  const textParts = parts.filter(isText);
  const finalTextPart = textParts.at(-1) ?? null;

  parts.forEach((part, index) => {
    if (isToolPart(part)) {
      const title = part.title ?? part.type.replace(/^tool-/, "tool");
      if (part.type === "tool-plan" && part.state === "output-available" && isPlanOutput(part.output)) {
        const entryCount = part.output.entries.length;
        thinkingCount += entryCount;
        activities.push({
          id: part.toolCallId,
          kind: "plan",
          title: `Plan updated (${entryCount} steps)`,
          status: "completed",
          detail: "Plan refreshed",
        });
        detailParts.push(part);
        return;
      }

      toolCount += 1;
      const running = isToolRunning(part);
      activities.push({
        id: part.toolCallId,
        kind: "tool",
        title,
        status: running ? "running" : "completed",
        detail: running ? "Running" : "Completed",
      });
      if (!running) {
        detailParts.push(part);
      }
      return;
    }

    if (isReasoning(part)) {
      thinkingCount += 1;
      const summary = summarizeText(part.text || "Thinking", 72);
      const isRunning =
        part.state === "streaming" || (isLiveMessage && index === parts.length - 1);
      activities.push({
        id: `thinking-${index}`,
        kind: "thinking",
        title: summary || "Thinking",
        status: isRunning ? "running" : "completed",
        detail: isRunning ? "Processing" : "Completed",
      });
      return;
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
  const isRunning = item.status === "running";
  const prevStatusRef = useRef<ActivityStatus>(item.status);

  useEffect(() => {
    if (prevStatusRef.current === "running" && item.status === "completed") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    prevStatusRef.current = item.status;
  }, [item.status]);

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
      <View className="min-h-11 flex-row items-center gap-2 py-1.5">
        <View className="relative h-2 w-2">
          <View className={`h-2 w-2 rounded-full ${getKindDotClass()}`} />
        </View>
        <ActivityIcon kind={item.kind} size={14} />
        <ActivityLabel
          kind={item.kind}
          numberOfLines={1}
          size="xs"
          title={item.title}
        />
        <ActivityStatusBadge item={item} status={item.status} />
      </View>
    );
  }

  return (
    <View
      className={cn_inline(
        "relative overflow-hidden border px-3 py-2",
        isRunning
          ? "border-accent/70 bg-accent/10"
          : "border-transparent bg-surface-foreground/5",
        isCompact ? "mb-2" : "mb-3"
      )}
    >
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
    </View>
  );
}
