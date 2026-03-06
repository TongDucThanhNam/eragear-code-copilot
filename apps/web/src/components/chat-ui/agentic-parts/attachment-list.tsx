"use client";

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
import {
  deduplicateKeys,
  type FilePart,
  getPartKey,
  type SourcePart,
} from "../agentic-message-utils";

export interface AttachmentListProps {
  items: Array<SourcePart | FilePart>;
  variant?: AttachmentVariant;
  showMediaType?: boolean;
  className?: string;
}

export function AttachmentList({
  items,
  variant = "inline",
  showMediaType,
  className,
}: AttachmentListProps) {
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
}
