import type { ReactNode } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { memo, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { ToolUIPart } from "@repo/shared";
import { ToolResultDisplay } from "./tool-result-display";

interface ToolCallPartProps {
  details?: ReactNode;
  errorText?: string;
  isExpanded: boolean;
  onToggle: () => void;
  output?: unknown;
  toolCallId: string;
  title: string;
  input: ToolUIPart["input"];
  state: ToolUIPart["state"];
}

const statusMeta: Record<
  ToolUIPart["state"],
  { label: string; className: string }
> = {
  "input-streaming": { label: "Preparing", className: "text-muted" },
  "input-available": { label: "Running", className: "text-warning" },
  "approval-requested": { label: "Awaiting approval", className: "text-warning" },
  "approval-responded": { label: "Approved", className: "text-success" },
  "output-available": { label: "Completed", className: "text-success" },
  "output-error": { label: "Failed", className: "text-danger" },
  "output-denied": { label: "Denied", className: "text-danger" },
  "output-cancelled": { label: "Cancelled", className: "text-muted" },
};

const truncateLabel = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

const getInputPreview = (input: ToolUIPart["input"]) => {
  if (input === undefined) {
    return "(waiting for input)";
  }
  if (input === null) {
    return "null";
  }
  if (typeof input === "string") {
    return truncateLabel(input.replace(/\s+/g, " ").trim(), 72);
  }
  if (typeof input === "number" || typeof input === "boolean") {
    return String(input);
  }
  if (Array.isArray(input)) {
    return input.length === 0 ? "[]" : `${input.length} items`;
  }
  if (typeof input === "object") {
    const keys = Object.keys(input as Record<string, unknown>);
    if (keys.length === 0) {
      return "{}";
    }
    const preview = keys.slice(0, 3).join(", ");
    return `{ ${preview}${keys.length > 3 ? ", ..." : ""} }`;
  }
  return String(input);
};

function ToolCallPartComponent({
  details,
  errorText,
  toolCallId,
  title,
  input,
  isExpanded,
  onToggle,
  output,
  state,
}: ToolCallPartProps) {
  const status = statusMeta[state];
  const expanded = isExpanded;
  const previewText = useMemo(() => {
    if (state === "output-error") {
      return truncateLabel(errorText ?? "Execution failed.", 72);
    }
    if (state === "output-denied") {
      return "Permission denied";
    }
    if (state === "output-cancelled") {
      return "Execution cancelled";
    }
    if (state === "output-available") {
      return getInputPreview(output);
    }
    return getInputPreview(input);
  }, [errorText, input, output, state]);
  const inputText = useMemo(() => {
    if (!expanded) {
      return null;
    }
    return input === undefined
      ? "(waiting for input)"
      : JSON.stringify(input, null, 2);
  }, [expanded, input]);
  const hasResult =
    state === "output-available" ||
    state === "output-error" ||
    state === "output-denied" ||
    state === "output-cancelled";
  const hasDetails = hasResult || details !== undefined;
  const canExpand = input !== undefined || hasDetails;

  return (
    <View className="mt-2 mb-2 rounded-xl border border-divider bg-background">
      <Pressable
        className="gap-1 px-3 py-2"
        disabled={!canExpand}
        onPress={onToggle}
      >
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1 flex-row items-center gap-2">
            <Ionicons
              className="text-muted-foreground"
              name="construct-outline"
              size={14}
            />
            <Text className="font-mono text-xs font-semibold text-foreground">
              {title}
            </Text>
            {!expanded ? (
              <Text
                className="min-w-0 flex-1 text-[11px] text-muted-foreground"
                numberOfLines={1}
              >
                {previewText}
              </Text>
            ) : null}
          </View>
          <View className="flex-row items-center gap-2">
            <Text className={`text-[10px] ${status.className}`}>
              {status.label}
            </Text>
            {canExpand ? (
              <Ionicons
                className="text-muted-foreground"
                name={expanded ? "chevron-up-outline" : "chevron-down-outline"}
                size={14}
              />
            ) : null}
          </View>
        </View>
      </Pressable>
      {expanded ? (
        <View className="border-divider border-t gap-2 px-3 pt-2 pb-3">
          {inputText ? (
            <View className="gap-1">
              <Text className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Input
              </Text>
              <Text className="font-mono text-xs text-muted" selectable>
                {inputText}
              </Text>
            </View>
          ) : null}
          {hasDetails ? (
            <View className="gap-1">
              <Text className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Result
              </Text>
              {details ?? (
                <ToolResultDisplay
                  errorText={errorText}
                  output={output}
                  state={state}
                />
              )}
            </View>
          ) : null}
          <Text
            className="font-mono text-[10px] text-muted-foreground"
            selectable
          >
            {toolCallId}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export const ToolCallPart = memo(ToolCallPartComponent);
