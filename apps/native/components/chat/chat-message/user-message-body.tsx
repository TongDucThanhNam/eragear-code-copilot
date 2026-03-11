import { useMemo } from "react";
import { View } from "react-native";
import type { UIMessagePart } from "@repo/shared";
import { CollapsibleMessageText } from "./collapsible-message-text";
import { MessagePartItem } from "./message-part-item";
import { AttachmentList } from "./attachment-list";
import { splitUserMessageParts } from "./message-item.utils";
import { getPartKey } from "./utils";
import { cn } from "heroui-native";

interface UserMessageBodyProps {
  parts: UIMessagePart[];
  bubbleMaxWidth: number;
}

export function UserMessageBody({
  parts,
  bubbleMaxWidth,
}: UserMessageBodyProps) {
  const renderData = useMemo(() => splitUserMessageParts(parts), [parts]);

  return (
    <View className="flex-col items-end gap-1.5">
      <View
        className={cn(
          "flex-col gap-1.5 rounded-2xl px-4 py-3",
          "self-end bg-accent text-white"
        )}
        style={{ maxWidth: bubbleMaxWidth }}
      >
        {renderData.text ? (
          <CollapsibleMessageText
            collapsedLines={10}
            text={renderData.text}
            textStyle={{
              color: "#ffffff",
              fontSize: 16,
              lineHeight: 22,
            }}
            toggleColor="rgba(255,255,255,0.85)"
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
