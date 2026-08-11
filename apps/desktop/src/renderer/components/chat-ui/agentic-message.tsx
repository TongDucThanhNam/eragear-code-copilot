// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import type { TextUIPart, UIMessagePart } from "@eragear-code-copilot/shared";
import { FileDiff } from "lucide-react";
import { memo, useMemo, useRef } from "react";
import {
  Message,
  MessageActions,
  MessageContent,
} from "@/components/ai-elements/message";
import { AssistantMessageBody } from "@/components/chat-ui/agentic-message/assistant-message-body";
import { CopyMessageAction } from "@/components/chat-ui/agentic-message/copy-message-action";
import { FeedbackMessageActions } from "@/components/chat-ui/agentic-message/feedback-message-actions";
import {
  buildMessageCopyText,
  type FilePart,
  isDataPart,
  type SourcePart,
} from "@/components/chat-ui/agentic-message-utils";
import { AttachmentList } from "@/components/chat-ui/agentic-parts/attachment-list";
import { UserTextParts } from "@/components/chat-ui/agentic-parts/user-text-parts";
import { useChatMessageById } from "@/store/chat-stream-store";
import { useChatTurnDiffStore } from "@/store/chat-turn-diff-store";

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

/**
 * Stable reference helper for message content to prevent unnecessary re-renders.
 * Returns a serialized string that changes only when actual content changes.
 */
function useMessageContentRef(message: {
  parts: UIMessagePart[];
  role: string;
  id: string;
}) {
  const ref = useRef<string>("");
  const serialized = `${message.role}:${message.id}:${message.parts.length}`;
  if (ref.current !== serialized) {
    ref.current = serialized;
  }
  return ref.current;
}

export const AgenticMessage = memo(
  function AgenticMessage({ chatId, messageId }: AgenticMessageProps) {
    const message = useChatMessageById(chatId, messageId);
    const turnDiff = useChatTurnDiffStore((state) => {
      if (!chatId) {
        return undefined;
      }
      const turnId = state.turnIdByMessageId[chatId]?.[messageId];
      return turnId ? state.byChatId[chatId]?.[turnId] : undefined;
    });
    if (!message) {
      return null;
    }
    const copyText = useMemo(() => buildMessageCopyText(message), [message]);
    const userParts = useMemo(
      () =>
        message.role === "user" ? getUserMessageParts(message.parts) : null,
      [message.parts, message.role]
    );
    const showUserContent = (userParts?.textParts.length ?? 0) > 0;
    const userAttachments = userParts?.attachmentParts ?? [];
    const diffTotals = turnDiff?.files.reduce(
      (totals, file) => ({
        additions: totals.additions + file.additions,
        deletions: totals.deletions + file.deletions,
      }),
      { additions: 0, deletions: 0 }
    );

    // Use content ref for memo comparison - changes only when parts actually change
    const _contentRef = useMessageContentRef(message);

    return (
      <Message data-message-id={message.id} from={message.role}>
        <div>
          {message.role === "assistant" ? (
            <MessageContent>
              <AssistantMessageBody chatId={chatId} parts={message.parts} />
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
          {message.role === "user" && turnDiff ? (
            <div className="mt-2 flex justify-end">
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2 py-1 font-medium text-muted-foreground text-xs">
                <FileDiff className="size-3.5" />
                {turnDiff.files.length} files
                <span className="text-emerald-600">
                  +{diffTotals?.additions ?? 0}
                </span>
                <span className="text-red-600">
                  −{diffTotals?.deletions ?? 0}
                </span>
              </span>
            </div>
          ) : null}
          <div className="mt-2 flex justify-end opacity-0 transition group-hover:opacity-100">
            <MessageActions>
              {message.role === "assistant" ? (
                <FeedbackMessageActions
                  chatId={chatId}
                  messageId={message.id}
                />
              ) : null}
              <CopyMessageAction text={copyText} />
            </MessageActions>
          </div>
        </div>
      </Message>
    );
  },
  (prevProps, nextProps) => {
    // Only re-render if chatId, messageId change
    // Message content changes are handled via useMessageContentRef in the component
    return (
      prevProps.chatId === nextProps.chatId &&
      prevProps.messageId === nextProps.messageId
    );
  }
);

// Separate display name for better debugging
AgenticMessage.displayName = "AgenticMessage";
