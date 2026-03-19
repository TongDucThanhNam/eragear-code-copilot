import { useMemo } from "react";
import { Text, View } from "react-native";
import { summarizeChainItems } from "./agentic-chain";
import { AttachmentList } from "./attachment-list";
import type { AssistantRenderData } from "./message-item.types";
import { buildPreviewText } from "./message-item.utils";

interface AssistantMessagePreviewProps {
  data: AssistantRenderData;
  isStreaming: boolean;
}

export function AssistantMessagePreview({
  data,
  isStreaming,
}: AssistantMessagePreviewProps) {
  const chainSummary = useMemo(
    () =>
      data.chainItems.length > 0 ? summarizeChainItems(data.chainItems) : null,
    [data.chainItems]
  );
  const previewText = useMemo(
    () => buildPreviewText(data.finalText),
    [data.finalText]
  );

  return (
    <View className="flex-col gap-3">
      {chainSummary ? (
        <View className="rounded-xl border border-divider bg-surface-foreground/5 px-3 py-2">
          <View className="flex-row items-center gap-2">
            <Text className="font-medium text-foreground text-sm">
              Chain of Thought
            </Text>
            <Text className="text-muted-foreground text-xs">
              {chainSummary.summary}
            </Text>
            {isStreaming ? (
              <Text className="text-[10px] text-accent">Updating...</Text>
            ) : null}
          </View>
        </View>
      ) : null}
      {previewText ? (
        <View className="flex-col gap-1.5 rounded-2xl bg-surface-foreground/5 px-4 py-3">
          <Text className="text-foreground" numberOfLines={8}>
            {previewText}
          </Text>
        </View>
      ) : null}
      {data.finalAttachments.length > 0 ? (
        <AttachmentList items={data.finalAttachments} />
      ) : null}
    </View>
  );
}
