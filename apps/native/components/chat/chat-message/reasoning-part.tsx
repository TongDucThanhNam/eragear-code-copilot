import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReasoningUIPart } from "@repo/shared";
import { Pressable, Text, View } from "react-native";

interface ReasoningPartProps {
  isExpanded: boolean;
  onToggle: () => void;
  text: string;
  state?: ReasoningUIPart["state"];
}

const normalizeReasoningText = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const wrapperMatch = trimmed.match(/^<([a-zA-Z][\w-]*)>([\s\S]*)<\/\1>$/);
  let normalized = wrapperMatch ? wrapperMatch[2].trim() : text;
  if (/<[a-zA-Z][^>]*>/.test(normalized)) {
    normalized = normalized.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  return normalized;
};

const canExpandReasoning = (text: string) =>
  text.length > 180 || text.split("\n").length > 2;

export function ReasoningPart({
  isExpanded,
  onToggle,
  text,
  state,
}: ReasoningPartProps) {
  const normalizedText = normalizeReasoningText(text);
  const displayText =
    normalizedText.trim().length > 0
      ? normalizedText
      : state === "streaming"
        ? "Thinking..."
        : "No reasoning details provided.";
  const expanded = isExpanded;
  const canExpand = canExpandReasoning(displayText);
  const label = state === "streaming" ? "Thinking" : "Reasoning";

  return (
    <View className="mb-2 rounded-xl border border-divider bg-background">
      <Pressable
        className="gap-1 px-3 py-2"
        disabled={!canExpand}
        onPress={onToggle}
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Ionicons className="text-accent" name="bulb-outline" size={14} />
            <Text className="font-semibold text-[11px] text-accent uppercase tracking-wide">
              {label}
            </Text>
          </View>
          {canExpand ? (
            <Ionicons
              className="text-muted-foreground"
              name={expanded ? "chevron-up-outline" : "chevron-down-outline"}
              size={14}
            />
          ) : null}
        </View>
        <Text
          className="text-muted text-sm italic"
          numberOfLines={expanded ? undefined : 2}
          selectable
        >
          {displayText}
        </Text>
        {canExpand ? (
          <Text className="font-medium text-[11px] text-accent">
            {expanded ? "Show less" : "Show more"}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}
