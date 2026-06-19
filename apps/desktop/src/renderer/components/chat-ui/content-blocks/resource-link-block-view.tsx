"use client";

import { ExternalLinkIcon } from "lucide-react";
import {
  Artifact,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import { BlockMeta } from "@/components/chat-ui/content-blocks/block-meta";
import { CopyButton } from "@/components/chat-ui/content-blocks/copy-button";
import {
  getFileName,
  HTTP_PROTOCOL,
  stripFileProtocol,
} from "@/components/chat-ui/content-blocks/shared";
import type { ResourceLinkBlock } from "@/components/chat-ui/content-blocks/types";
import { Button } from "@/components/ui/button";

interface ResourceLinkBlockViewProps {
  block: ResourceLinkBlock;
}

export function ResourceLinkBlockView({ block }: ResourceLinkBlockViewProps) {
  const title = block.title || block.name || getFileName(block.uri, "resource");
  const description =
    block.description || stripFileProtocol(block.uri) || block.name;
  const displayUri = stripFileProtocol(block.uri);
  const canOpen = HTTP_PROTOCOL.test(block.uri);

  return (
    <Artifact>
      <ArtifactHeader>
        <div className="min-w-0">
          <ArtifactTitle className="truncate">{title}</ArtifactTitle>
          {description ? (
            <ArtifactDescription className="truncate">
              {description}
            </ArtifactDescription>
          ) : null}
        </div>
        <ArtifactActions>
          {canOpen ? (
            <Button asChild size="icon-sm" variant="ghost">
              <a
                aria-label="Open resource"
                href={block.uri}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLinkIcon className="size-3.5" />
              </a>
            </Button>
          ) : null}
          <CopyButton label="Copy URI" value={block.uri} />
        </ArtifactActions>
      </ArtifactHeader>
      <ArtifactContent>
        <div className="space-y-2">
          {displayUri ? (
            <code className="block truncate rounded bg-muted/50 px-2 py-1 text-xs">
              {displayUri}
            </code>
          ) : null}
          <BlockMeta
            annotations={block.annotations}
            mimeType={block.mimeType ?? undefined}
            size={block.size ?? undefined}
          />
        </div>
      </ArtifactContent>
    </Artifact>
  );
}
