"use client";

import { AudioBlockView } from "@/components/chat-ui/content-blocks/audio-block-view";
import { ImageBlockView } from "@/components/chat-ui/content-blocks/image-block-view";
import { ResourceBlockView } from "@/components/chat-ui/content-blocks/resource-block-view";
import { ResourceLinkBlockView } from "@/components/chat-ui/content-blocks/resource-link-block-view";
import { getBlockKey } from "@/components/chat-ui/content-blocks/shared";
import type { StoredContentBlock } from "@/components/chat-ui/content-blocks/types";

export type { StoredContentBlock } from "@/components/chat-ui/content-blocks/types";

export const ContentBlocksView = ({
  blocks,
}: {
  blocks: StoredContentBlock[];
}) => {
  const displayBlocks = blocks.filter((block) => block.type !== "text");

  if (displayBlocks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {displayBlocks.map((block, index) => {
        const key = getBlockKey(block, index);
        switch (block.type) {
          case "image":
            return <ImageBlockView block={block} key={key} />;
          case "audio":
            return <AudioBlockView block={block} key={key} />;
          case "resource":
            return <ResourceBlockView block={block} key={key} />;
          case "resource_link":
            return <ResourceLinkBlockView block={block} key={key} />;
          default:
            return null;
        }
      })}
    </div>
  );
};
