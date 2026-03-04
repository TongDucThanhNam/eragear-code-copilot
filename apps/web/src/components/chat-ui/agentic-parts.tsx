"use client";

import type { ReasoningUIPart, TextUIPart } from "@repo/shared";
import { FileTextIcon, ImageIcon, LinkIcon } from "lucide-react";
import { memo } from "react";
import type {
  AttachmentData,
  AttachmentVariant,
} from "@/components/ai-elements/attachments";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from "@/components/ai-elements/attachments";
import { MessageResponse } from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  deduplicateKeys,
  type FilePart,
  getPartKey,
  type SourcePart,
} from "./agentic-message-utils";

export const getSourceIcon = (part: SourcePart) => {
  if (part.type === "source-url") {
    return LinkIcon;
  }
  return FileTextIcon;
};

export const getFileIcon = (part: FilePart) => {
  if (part.mediaType?.startsWith("image/")) {
    return ImageIcon;
  }
  return FileTextIcon;
};

export const TextMessagePart = memo(
  ({ text, variant }: { text: string; variant?: "chain" | "final" }) => (
    <MessageResponse
      className={cn(
        variant === "chain" && "text-muted-foreground",
        variant === "final" && "leading-relaxed"
      )}
    >
      {text}
    </MessageResponse>
  )
);
TextMessagePart.displayName = "TextMessagePart";

const normalizeReasoningText = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const wrapperMatch = trimmed.match(/^<([a-zA-Z][\w-]*)>([\s\S]*)<\/\1>$/);
  let normalized = wrapperMatch ? wrapperMatch[2].trim() : text;
  if (/<[a-zA-Z][^>]*>/.test(normalized)) {
    normalized = normalized.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  return normalized;
};

export const ReasoningMessagePart = memo(
  ({
    text,
    state,
  }: {
    text: ReasoningUIPart["text"];
    state?: ReasoningUIPart["state"];
  }) => {
    const normalizedText = normalizeReasoningText(text);
    const displayText =
      normalizedText.trim().length > 0 || state === "streaming"
        ? normalizedText
        : "No reasoning details provided.";

    return (
      <Reasoning
        className="mb-0"
        defaultOpen={false}
        isStreaming={state === "streaming"}
      >
        <ReasoningTrigger />
        <ReasoningContent>{displayText}</ReasoningContent>
      </Reasoning>
    );
  }
);
ReasoningMessagePart.displayName = "ReasoningMessagePart";

export const SourceMessagePart = memo(({ part }: { part: SourcePart }) => {
  const Icon = getSourceIcon(part);
  const label =
    part.type === "source-url"
      ? (part.title ?? part.url)
      : (part.title ?? part.filename ?? part.sourceId);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            className="flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
            variant="outline"
          >
            <Icon className="size-3 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="wrap-break-word max-w-xs text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
SourceMessagePart.displayName = "SourceMessagePart";

export const FileMessagePart = memo(({ part }: { part: FilePart }) => {
  const Icon = getFileIcon(part);
  const label = part.filename ?? part.mediaType ?? "File";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            className="flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
            variant="outline"
          >
            <Icon className="size-3 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="wrap-break-word max-w-xs text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
FileMessagePart.displayName = "FileMessagePart";

export const AttachmentList = ({
  items,
  variant = "inline",
  showMediaType,
  className,
}: {
  items: Array<SourcePart | FilePart>;
  variant?: AttachmentVariant;
  showMediaType?: boolean;
  className?: string;
}) => {
  if (items.length === 0) {
    return null;
  }
  const keys = deduplicateKeys(items, getPartKey);

  const shouldShowMediaType =
    typeof showMediaType === "boolean"
      ? showMediaType
      : variant === "list";

  return (
    <Attachments className={className} variant={variant}>
      {items.map((part, index) => {
        const id = keys[index] ?? `attachment:${index}`;
        const data: AttachmentData = { id, ...part };
        return (
          <Attachment data={data} key={id}>
            <AttachmentPreview />
            <AttachmentInfo showMediaType={shouldShowMediaType} />
          </Attachment>
        );
      })}
    </Attachments>
  );
};

export const UserTextParts = ({ parts }: { parts: TextUIPart[] }) => {
  const keys = deduplicateKeys(parts, getPartKey);
  return (
    <>
      {parts.map((part, index) => {
        const key = keys[index] ?? `text:${index}`;
        return <TextMessagePart key={key} text={part.text} />;
      })}
    </>
  );
};
