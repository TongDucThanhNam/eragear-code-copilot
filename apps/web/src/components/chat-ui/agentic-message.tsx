"use client";

import type { TextUIPart, UIMessagePart } from "@repo/shared";
import { memo, useMemo } from "react";
import {
  Message,
  MessageActions,
  MessageContent,
} from "@/components/ai-elements/message";
import {
  buildMessageCopyText,
  type FilePart,
  isDataPart,
  type SourcePart,
} from "@/components/chat-ui/agentic-message-utils";
import { AttachmentList } from "@/components/chat-ui/agentic-parts/attachment-list";
import { UserTextParts } from "@/components/chat-ui/agentic-parts/user-text-parts";
import { AssistantMessageBody } from "@/components/chat-ui/agentic-message/assistant-message-body";
import { CopyMessageAction } from "@/components/chat-ui/agentic-message/copy-message-action";
import { useChatMessageById } from "@/store/chat-stream-store";

export interface AgenticMessageProps {
  chatId: string | null;
  messageId: string;
}

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

export const AgenticMessage = memo(function AgenticMessage({
  chatId,
  messageId,
}: AgenticMessageProps) {
  const message = useChatMessageById(chatId, messageId);
  if (!message) {
    return null;
  }
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
              chatId={chatId}
              parts={message.parts}
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
},
  (prevProps, nextProps) =>
    prevProps.chatId === nextProps.chatId &&
    prevProps.messageId === nextProps.messageId
);
