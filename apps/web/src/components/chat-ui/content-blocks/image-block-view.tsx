"use client";

import { BlockMeta } from "@/components/chat-ui/content-blocks/block-meta";
import {
  buildDataUrl,
  getFileName,
  getRenderableUri,
} from "@/components/chat-ui/content-blocks/shared";
import type { ImageBlock } from "@/components/chat-ui/content-blocks/types";

interface ImageBlockViewProps {
  block: ImageBlock;
}

export function ImageBlockView({ block }: ImageBlockViewProps) {
  const src =
    buildDataUrl(block.mimeType, block.data) ?? getRenderableUri(block.uri);
  const title = getFileName(block.uri, "image");
  return (
    <div className="overflow-hidden rounded-md border bg-muted/30">
      {src ? (
        <img
          alt={title}
          className="max-h-[360px] w-full object-contain"
          src={src}
        />
      ) : (
        <div className="flex h-40 items-center justify-center text-muted-foreground text-xs">
          Image unavailable
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-background/60 px-3 py-2">
        <span className="truncate text-xs">{title}</span>
        <BlockMeta annotations={block.annotations} mimeType={block.mimeType} />
      </div>
    </div>
  );
}
