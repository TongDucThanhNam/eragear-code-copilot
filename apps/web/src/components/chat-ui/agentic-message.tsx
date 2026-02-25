"use client";

import type { TextUIPart, UIMessage, UIMessagePart } from "@repo/shared";
import { CheckIcon, CopyIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ai-elements/message";
import { ChainOfThought } from "@/components/chat-ui/agentic-chain";
import {
  buildMessageCopyText,
  type FilePart,
  getMessageTerminalIds,
  isDataPart,
  isMessageStreaming,
  resolveAssistantFinalVisibility,
  type SourcePart,
  splitMessageParts,
} from "@/components/chat-ui/agentic-message-utils";
import {
  AttachmentList,
  TextMessagePart,
  UserTextParts,
} from "@/components/chat-ui/agentic-parts";

export interface AgenticMessageProps {
  message: UIMessage;
  terminalOutputs?: Record<string, string>;
}

const CopyMessageAction = memo(({ text }: { text: string }) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    if (!text) {
      return;
    }

    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      toast.error("Clipboard API not available");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      toast.success("Copied message");
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy message");
    }
  };

  const Icon = isCopied ? CheckIcon : CopyIcon;

  return (
    <MessageAction
      aria-label="Copy message"
      disabled={!text}
      label="Copy message"
      onClick={handleCopy}
      tooltip={isCopied ? "Copied" : "Copy"}
    >
      <Icon className="size-3.5" />
    </MessageAction>
  );
});
CopyMessageAction.displayName = "CopyMessageAction";

const AssistantMessageBody = ({
  parts,
  terminalOutputs,
}: {
  parts: UIMessagePart[];
  terminalOutputs?: Record<string, string>;
}) => {
  const { chainItems, finalText, finalAttachments } = useMemo(
    () => splitMessageParts(parts),
    [parts]
  );
  const streaming = useMemo(() => isMessageStreaming(parts), [parts]);
  const finalVisibility = useMemo(
    () =>
      resolveAssistantFinalVisibility({
        finalText,
        finalAttachmentsCount: finalAttachments.length,
        isStreaming: streaming,
        chainItemsCount: chainItems.length,
      }),
    [chainItems.length, finalAttachments.length, finalText, streaming]
  );

  return (
    <>
      {chainItems.length > 0 && (
        <ChainOfThought
          isStreaming={streaming}
          items={chainItems}
          terminalOutputs={terminalOutputs}
        />
      )}
      {finalVisibility.shouldRenderFinal && (
        <div className="space-y-3">
          {finalVisibility.showFinalText ? (
            <TextMessagePart text={finalText ?? ""} variant="final" />
          ) : null}
          {finalVisibility.showFinalAttachments ? (
            <AttachmentList items={finalAttachments} />
          ) : null}
        </div>
      )}
    </>
  );
};

const getUserMessageParts = (parts: UIMessagePart[]) => {
  const displayParts = parts.filter((part) => !isDataPart(part));
  const textParts = displayParts.filter(
    (part): part is TextUIPart => part.type === "text"
  );
  const attachmentParts = displayParts.filter(
    (part): part is SourcePart | FilePart =>
      part.type === "source-url" ||
      part.type === "source-document" ||
      part.type === "file"
  );
  return { textParts, attachmentParts };
};

const areTerminalOutputsEqual = (
  prev: Record<string, string> | undefined,
  next: Record<string, string> | undefined,
  message: UIMessage
) => {
  const terminalIds = getMessageTerminalIds(message);
  if (terminalIds.length === 0) {
    return true;
  }
  if (prev === next) {
    return true;
  }
  if (!(prev && next)) {
    return false;
  }
  for (const terminalId of terminalIds) {
    const prevValue = prev[terminalId] ?? "";
    const nextValue = next[terminalId] ?? "";
    if (prevValue !== nextValue) {
      return false;
    }
  }
  return true;
};

const AgenticMessageBase = ({
  message,
  terminalOutputs,
}: AgenticMessageProps) => {
  const copyText = useMemo(() => buildMessageCopyText(message), [message]);
  const userParts = useMemo(
    () => (message.role === "user" ? getUserMessageParts(message.parts) : null),
    [message.parts, message.role]
  );
  const showUserContent = (userParts?.textParts.length ?? 0) > 0;
  const userAttachments = userParts?.attachmentParts ?? [];

  return (
    <Message from={message.role}>
      <div>
        {message.role === "assistant" ? (
          <MessageContent>
            <AssistantMessageBody
              parts={message.parts}
              terminalOutputs={terminalOutputs}
            />
          </MessageContent>
        ) : showUserContent ? (
          <MessageContent>
            <UserTextParts parts={userParts?.textParts ?? []} />
          </MessageContent>
        ) : null}
        {message.role === "user" && userAttachments.length > 0 ? (
          <AttachmentList
            className="mt-2"
            items={userAttachments}
            variant="grid"
          />
        ) : null}
        <div className="mt-2 flex justify-end opacity-0 transition group-hover:opacity-100">
          <MessageActions>
            <CopyMessageAction text={copyText} />
          </MessageActions>
        </div>
      </div>
    </Message>
  );
};

export const AgenticMessage = memo(
  AgenticMessageBase,
  (prevProps, nextProps) => {
    if (prevProps.message !== nextProps.message) {
      return false;
    }
    return areTerminalOutputsEqual(
      prevProps.terminalOutputs,
      nextProps.terminalOutputs,
      prevProps.message
    );
  }
);
AgenticMessage.displayName = "AgenticMessage";
