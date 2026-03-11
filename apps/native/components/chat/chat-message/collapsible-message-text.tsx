import { memo, useMemo, useState } from "react";
import { Pressable, Text, type TextStyle, View } from "react-native";
import MarkdownText from "./text-part";

const COLLAPSE_CHAR_THRESHOLD = 360;
const COLLAPSE_NEWLINE_THRESHOLD = 8;

interface CollapsibleMessageTextProps {
  collapsedLines?: number;
  textStyle?: TextStyle;
  toggleColor?: string;
  text: string;
}

function shouldCollapseText(text: string) {
  if (text.length > COLLAPSE_CHAR_THRESHOLD) {
    return true;
  }
  const lineBreakCount = text.split("\n").length - 1;
  return lineBreakCount >= COLLAPSE_NEWLINE_THRESHOLD;
}

function CollapsibleMessageTextComponent({
  collapsedLines = 12,
  textStyle,
  toggleColor,
  text,
}: CollapsibleMessageTextProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canCollapse = useMemo(() => shouldCollapseText(text), [text]);

  return (
    <View className="gap-2">
      <MarkdownText
        numberOfLines={!isExpanded && canCollapse ? collapsedLines : undefined}
        style={textStyle}
      >
        {text}
      </MarkdownText>
      {canCollapse ? (
        <Pressable onPress={() => setIsExpanded((current) => !current)}>
          <Text
            className="font-medium text-[12px]"
            style={toggleColor ? { color: toggleColor } : undefined}
          >
            {isExpanded ? "Show less" : "Show more"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const CollapsibleMessageText = memo(CollapsibleMessageTextComponent);
