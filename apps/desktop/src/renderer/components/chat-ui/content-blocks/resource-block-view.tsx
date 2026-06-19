"use client";

import { DownloadIcon } from "lucide-react";
import {
  Artifact,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import {
  CodeBlock,
  CodeBlockCopyButton,
} from "@/components/ai-elements/code-block";
import { AudioBlockView } from "@/components/chat-ui/content-blocks/audio-block-view";
import { BlockMeta } from "@/components/chat-ui/content-blocks/block-meta";
import { CopyButton } from "@/components/chat-ui/content-blocks/copy-button";
import { ImageBlockView } from "@/components/chat-ui/content-blocks/image-block-view";
import {
  buildDataUrl,
  getFileName,
  guessLanguage,
  stripFileProtocol,
} from "@/components/chat-ui/content-blocks/shared";
import type { ResourceBlock } from "@/components/chat-ui/content-blocks/types";
import { Button } from "@/components/ui/button";

interface ResourceBlockViewProps {
  block: ResourceBlock;
}

export function ResourceBlockView({ block }: ResourceBlockViewProps) {
  const { resource } = block;
  const title = getFileName(resource.uri, "embedded resource");
  const description = stripFileProtocol(resource.uri);
  const mimeType = resource.mimeType;

  if (resource.text) {
    const language = guessLanguage(mimeType, resource.uri);
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
        </ArtifactHeader>
        <ArtifactContent className="space-y-2">
          <CodeBlock
            className="max-h-80"
            code={resource.text}
            language={language}
          >
            <CodeBlockCopyButton />
          </CodeBlock>
          <BlockMeta annotations={block.annotations} mimeType={mimeType} />
        </ArtifactContent>
      </Artifact>
    );
  }

  if (resource.blob) {
    if (mimeType?.startsWith("image/")) {
      return (
        <ImageBlockView
          block={{
            type: "image",
            data: resource.blob,
            mimeType,
            uri: resource.uri,
            annotations: block.annotations,
          }}
        />
      );
    }
    if (mimeType?.startsWith("audio/")) {
      return (
        <AudioBlockView
          block={{
            type: "audio",
            data: resource.blob,
            mimeType,
            uri: resource.uri,
            annotations: block.annotations,
          }}
        />
      );
    }

    const dataUrl = buildDataUrl(mimeType, resource.blob);
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
            {dataUrl ? (
              <Button asChild size="sm" variant="outline">
                <a download={title} href={dataUrl}>
                  <DownloadIcon className="size-3.5" />
                  Download
                </a>
              </Button>
            ) : null}
            <CopyButton label="Copy URI" value={resource.uri} />
          </ArtifactActions>
        </ArtifactHeader>
        <ArtifactContent className="space-y-2">
          {description ? (
            <code className="block truncate rounded bg-muted/50 px-2 py-1 text-xs">
              {description}
            </code>
          ) : null}
          <BlockMeta annotations={block.annotations} mimeType={mimeType} />
        </ArtifactContent>
      </Artifact>
    );
  }

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
      </ArtifactHeader>
      <ArtifactContent>
        <p className="text-muted-foreground text-xs">No resource content.</p>
      </ArtifactContent>
    </Artifact>
  );
}
