"use client";

import type { UIMessagePart } from "@repo/shared";
import { useMemo } from "react";
import { ChainOfThought } from "@/components/chat-ui/agentic-chain";
import { AttachmentList } from "@/components/chat-ui/agentic-parts/attachment-list";
import { TextMessagePart } from "@/components/chat-ui/agentic-parts/text-message-part";
import {
  isChainStreaming,
  isMessageStreaming,
  resolveAssistantFinalVisibility,
  splitMessageParts,
} from "@/components/chat-ui/agentic-message-utils";

export interface AssistantMessageBodyProps {
  chatId: string | null;
  parts: UIMessagePart[];
}

export function AssistantMessageBody({
  chatId,
  parts,
}: AssistantMessageBodyProps) {
  const { chainItems, finalText, finalAttachments } = useMemo(
    () => splitMessageParts(parts),
    [parts]
  );
  const messageStreaming = useMemo(() => isMessageStreaming(parts), [parts]);
  const chainStreaming = useMemo(() => isChainStreaming(parts), [parts]);
  const finalVisibility = useMemo(
    () =>
      resolveAssistantFinalVisibility({
        finalText,
        finalAttachmentsCount: finalAttachments.length,
        isStreaming: messageStreaming,
        chainItemsCount: chainItems.length,
      }),
    [chainItems.length, finalAttachments.length, finalText, messageStreaming]
  );

  return (
    <>
      {chainItems.length > 0 ? (
        <ChainOfThought
          chatId={chatId}
          isStreaming={chainStreaming}
          items={chainItems}
        />
      ) : null}
      {finalVisibility.shouldRenderFinal ? (
        <div className="space-y-3">
          {finalVisibility.showFinalText ? (
            <TextMessagePart text={finalText ?? ""} variant="final" />
          ) : null}
          {finalVisibility.showFinalAttachments ? (
            <AttachmentList items={finalAttachments} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
