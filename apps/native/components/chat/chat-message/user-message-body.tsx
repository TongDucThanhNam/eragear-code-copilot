import type { UIMessagePart } from "@repo/shared";
import { cn, useThemeColor } from "heroui-native";
import { useMemo } from "react";
import { View } from "react-native";
import { AttachmentList } from "./attachment-list";
import { CollapsibleMessageText } from "./collapsible-message-text";
import { splitUserMessageParts } from "./message-item.utils";
import { MessagePartItem } from "./message-part-item";
import { getPartKey } from "./utils";

interface UserMessageBodyProps {
  parts: UIMessagePart[];
  bubbleMaxWidth: number;
}

export function UserMessageBody({
  parts,
  bubbleMaxWidth,
}: UserMessageBodyProps) {
  const renderData = useMemo(() => splitUserMessageParts(parts), [parts]);
  const foregroundColor = useThemeColor("foreground");
  const mutedColor = useThemeColor("muted");

  return (
    <View className="flex-col items-end gap-1.5">
      <View
        className={cn(
          "flex-col gap-1.5 rounded-[24px] px-5 py-4",
          "self-end bg-default"
        )}
        style={{ maxWidth: bubbleMaxWidth }}
      >
        {renderData.text ? (
          <CollapsibleMessageText
            collapsedLines={10}
            text={renderData.text}
            textStyle={{
              color: foregroundColor,
              fontSize: 16,
              lineHeight: 22,
            }}
            toggleColor={mutedColor}
          />
        ) : null}
        {renderData.fallbackParts.map((part, index) => (
          <MessagePartItem key={getPartKey(part, index)} part={part} />
        ))}
        {renderData.attachments.length > 0 ? (
          <AttachmentList items={renderData.attachments} />
        ) : null}
      </View>
    </View>
  );
}
