import { Text, View } from "react-native";
import type { ReasoningUIPart } from "@repo/shared";

interface ReasoningPartProps {
  text: string;
  state?: ReasoningUIPart["state"];
}

const normalizeReasoningText = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const wrapperMatch = trimmed.match(
    /^<([a-zA-Z][\w-]*)>([\s\S]*)<\/\1>$/
  );
  let normalized = wrapperMatch ? wrapperMatch[2].trim() : text;
  if (/<[a-zA-Z][^>]*>/.test(normalized)) {
    normalized = normalized.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  return normalized;
};

export function ReasoningPart({ text, state }: ReasoningPartProps) {
  const normalizedText = normalizeReasoningText(text);
  const displayText =
    normalizedText.trim().length > 0
      ? normalizedText
      : state === "streaming"
        ? "Thinking..."
        : "No reasoning details provided.";

  return (
    <View className="mb-2 border-muted border-l-2 pl-2">
      <Text className="text-muted text-sm italic">{displayText}</Text>
    </View>
  );
}
