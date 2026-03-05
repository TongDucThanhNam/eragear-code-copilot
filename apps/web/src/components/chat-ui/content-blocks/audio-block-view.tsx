"use client";

import { BlockMeta } from "@/components/chat-ui/content-blocks/block-meta";
import {
  buildDataUrl,
  getFileName,
  getRenderableUri,
} from "@/components/chat-ui/content-blocks/shared";
import type { AudioBlock } from "@/components/chat-ui/content-blocks/types";

interface AudioBlockViewProps {
  block: AudioBlock;
}

export function AudioBlockView({ block }: AudioBlockViewProps) {
  const src =
    buildDataUrl(block.mimeType, block.data) ?? getRenderableUri(block.uri);
  const title = getFileName(block.uri, "audio");
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      {src ? (
        <audio className="w-full" controls src={src}>
          {block.caption && (
            <track default kind="captions" src={block.caption} />
          )}
        </audio>
      ) : (
        <div className="text-muted-foreground text-xs">Audio unavailable</div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="truncate text-xs">{title}</span>
        <BlockMeta annotations={block.annotations} mimeType={block.mimeType} />
      </div>
    </div>
  );
}
