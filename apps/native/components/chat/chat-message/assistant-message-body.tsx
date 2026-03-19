import type { UIMessage } from "@repo/shared";
import { cn } from "heroui-native";
import { startTransition, useEffect, useRef, useState } from "react";
import { InteractionManager, View } from "react-native";
import { ChainOfThought } from "./agentic-chain";
import {
  isMessageStreaming,
  resolveAssistantFinalVisibility,
} from "./agentic-message-utils";
import { AssistantMessagePreview } from "./assistant-message-preview";
import { AttachmentList } from "./attachment-list";
import { CollapsibleMessageText } from "./collapsible-message-text";
import type { AssistantRenderData } from "./message-item.types";

interface AssistantMessageBodyProps {
  data: AssistantRenderData;
  isLiveMessage: boolean;
  parts: UIMessage["parts"];
  messageId: string;
}

export function AssistantMessageBody({
  data,
  isLiveMessage,
  parts,
  messageId,
}: AssistantMessageBodyProps) {
  const isStreaming = isMessageStreaming(parts) || isLiveMessage;
  const finalVisibility = resolveAssistantFinalVisibility({
    finalText: data.finalText,
    finalAttachmentsCount: data.finalAttachments.length,
    isStreaming,
    chainItemsCount: data.chainItems.length,
  });
  const [isRichContentReady, setIsRichContentReady] = useState(isLiveMessage);
  const richContentMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (richContentMessageIdRef.current !== messageId) {
      richContentMessageIdRef.current = messageId;
      setIsRichContentReady(isLiveMessage);
    }

    if (isLiveMessage || isRichContentReady) {
      return;
    }

    const task = InteractionManager.runAfterInteractions(() => {
      startTransition(() => {
        setIsRichContentReady(true);
      });
    });

    return () => {
      task.cancel();
    };
  }, [isLiveMessage, isRichContentReady, messageId]);

  if (!isRichContentReady) {
    return <AssistantMessagePreview data={data} isStreaming={isStreaming} />;
  }

  if (data.chainItems.length === 0) {
    // Use the pre-merged finalText from splitMessageParts to prevent
    // markdown fragmentation when text is split across multiple parts
    // (server may split text due to streaming state transitions).
    return (
      <View className="flex-col items-start gap-1.5">
        <View
          className={cn(
            "flex-col gap-1.5 rounded-2xl px-4 py-3",
            "max-w-[88%] self-start bg-surface-foreground/5"
          )}
        >
          {data.finalText ? (
            <CollapsibleMessageText text={data.finalText} />
          ) : null}
          {data.finalAttachments.length > 0 ? (
            <AttachmentList items={data.finalAttachments} />
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View className="flex-col gap-3">
      {/* Chain of Thought */}
      <ChainOfThought
        isStreaming={isStreaming}
        items={data.chainItems}
        messageId={messageId}
      />
      {/* Final Text Part */}
      {finalVisibility.shouldRenderFinal && (
        <View className="flex-col gap-3">
          {finalVisibility.showFinalText && data.finalText ? (
            <CollapsibleMessageText text={data.finalText} />
          ) : null}
          {finalVisibility.showFinalAttachments ? (
            <AttachmentList items={data.finalAttachments} />
          ) : null}
        </View>
      )}
    </View>
  );
}
