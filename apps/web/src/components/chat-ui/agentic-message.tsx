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
  AttachmentList,
  TextMessagePart,
  UserTextParts,
} from "@/components/chat-ui/agentic-parts";
import {
  buildMessageCopyText,
  buildPermissionByToolCallId,
  isDataPart,
  isMessageStreaming,
  splitMessageParts,
  type FilePart,
  type SourcePart,
} from "@/components/chat-ui/agentic-message-utils";

export interface AgenticMessageProps {
  message: UIMessage;
  terminalOutputs?: Record<string, string>;
  onApprove?: (requestId: string, decision?: string) => void;
  onReject?: (requestId: string, decision?: string) => void;
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
  onApprove,
  onReject,
}: {
  parts: UIMessagePart[];
  terminalOutputs?: Record<string, string>;
  onApprove?: (requestId: string, decision?: string) => void;
  onReject?: (requestId: string, decision?: string) => void;
}) => {
  const { chainItems, finalText, finalAttachments } = useMemo(
    () => splitMessageParts(parts),
    [parts]
  );
  const permissionByToolCallId = useMemo(
    () => buildPermissionByToolCallId(parts),
    [parts]
  );
  const streaming = useMemo(() => isMessageStreaming(parts), [parts]);
  const shouldShowFinal =
    (!!finalText || finalAttachments.length > 0) &&
    (!streaming || chainItems.length === 0);

  return (
    <>
      {chainItems.length > 0 && (
        <ChainOfThought
          isStreaming={streaming}
          items={chainItems}
          onApprove={onApprove}
          onReject={onReject}
          permissionByToolCallId={permissionByToolCallId}
          terminalOutputs={terminalOutputs}
        />
      )}
      {shouldShowFinal && (
        <div className="space-y-3">
          {finalText ? (
            <TextMessagePart text={finalText} variant="final" />
          ) : null}
          <AttachmentList items={finalAttachments} />
        </div>
      )}
    </>
  );
};

const UserMessageBody = ({ parts }: { parts: UIMessagePart[] }) => {
  const displayParts = useMemo(
    () => parts.filter((part) => !isDataPart(part)),
    [parts]
  );
  const textParts = displayParts.filter(
    (part): part is TextUIPart => part.type === "text"
  );
  const attachmentParts = displayParts.filter(
    (part): part is SourcePart | FilePart =>
      part.type === "source-url" ||
      part.type === "source-document" ||
      part.type === "file"
  );

  return (
    <>
      <UserTextParts parts={textParts} />
      <AttachmentList items={attachmentParts} />
    </>
  );
};

export function AgenticMessage({
  message,
  terminalOutputs,
  onApprove,
  onReject,
}: AgenticMessageProps) {
  const copyText = useMemo(() => buildMessageCopyText(message), [message]);

  return (
    <Message from={message.role}>
      <div>
        <MessageContent>
          {message.role === "user" ? (
            <UserMessageBody parts={message.parts} />
          ) : (
            <AssistantMessageBody
              onApprove={onApprove}
              onReject={onReject}
              parts={message.parts}
              terminalOutputs={terminalOutputs}
            />
          )}
        </MessageContent>
        <div className="mt-2 flex justify-end opacity-0 transition group-hover:opacity-100">
          <MessageActions>
            <CopyMessageAction text={copyText} />
          </MessageActions>
        </div>
      </div>
    </Message>
  );
}
