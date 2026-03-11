import { Text, View } from "react-native";
import type { UIMessagePart } from "@repo/shared";
import { CollapsibleMessageText } from "./collapsible-message-text";
import { PartRenderers } from "./part-renderers";

interface ChainContentProps {
  isExpanded: boolean;
  onToggle: () => void;
  part: UIMessagePart;
}

export function ChainContent({
  isExpanded,
  onToggle,
  part,
}: ChainContentProps) {
  if (part.type === "text") {
    return (
      <View className="opacity-80">
        <CollapsibleMessageText
          collapsedLines={isExpanded ? 6 : 3}
          text={part.text}
        />
      </View>
    );
  }

  if (part.type === "step-start") {
    return <Text className="text-muted-foreground text-xs">Step</Text>;
  }

  return (
    <PartRenderers isExpanded={isExpanded} onToggle={onToggle} part={part} />
  );
}
