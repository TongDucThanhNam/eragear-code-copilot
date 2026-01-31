"use client";

import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { useState } from "react";
import type { BundledLanguage } from "shiki";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type StoredContentBlock =
  | { type: "text"; text: string; annotations?: unknown }
  | {
      type: "image";
      data: string;
      mimeType: string;
      uri?: string;
      annotations?: unknown;
    }
  | {
      type: "audio";
      data: string;
      mimeType: string;
      annotations?: unknown;
      uri?: string;
    }
  | {
      type: "resource";
      resource: {
        uri: string;
        text?: string;
        blob?: string;
        mimeType?: string;
      };
      annotations?: unknown;
    }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      mimeType?: string | null;
      title?: string | null;
      description?: string | null;
      size?: number | null;
      annotations?: unknown;
    };

type ImageBlock = Extract<StoredContentBlock, { type: "image" }>;
type AudioBlock = Extract<StoredContentBlock, { type: "audio" }>;
type ResourceBlock = Extract<StoredContentBlock, { type: "resource" }>;
type ResourceLinkBlock = Extract<StoredContentBlock, { type: "resource_link" }>;
const FILE_PROTOCOL = /^file:\/\//i;
const HTTP_PROTOCOL = /^https?:\/\//i;
const DATA_PROTOCOL = /^data:/i;
const MIME_LANGUAGE_MAP: Record<string, BundledLanguage> = {
  "application/json": "json",
  "application/javascript": "javascript",
  "application/typescript": "typescript",
  "text/javascript": "javascript",
  "text/typescript": "typescript",
  "text/markdown": "markdown",
  "text/plain": "plaintext",
  "text/html": "html",
  "text/css": "css",
  "text/x-python": "python",
  "text/x-shellscript": "bash",
  "text/yaml": "yaml",
  "application/x-yaml": "yaml",
};
const EXT_LANGUAGE_MAP: Record<string, BundledLanguage> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  json: "json",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  sh: "bash",
  html: "html",
  css: "css",
};
const stripFileProtocol = (uri?: string) => {
  if (!uri) return "";
  return uri.replace(FILE_PROTOCOL, "");
};

const getFileName = (uri?: string, fallback = "resource") => {
  if (!uri) return fallback;
  const cleaned = stripFileProtocol(uri);
  const segment = cleaned.split("/").pop();
  return segment || cleaned || fallback;
};

const getRenderableUri = (uri?: string) => {
  if (!uri) return null;
  if (DATA_PROTOCOL.test(uri) || HTTP_PROTOCOL.test(uri)) {
    return uri;
  }
  return null;
};
const buildDataUrl = (mimeType?: string, data?: string) => {
  if (!data) return null;
  const safeType = mimeType || "application/octet-stream";
  return `data:${safeType};base64,${data}`;
};
const formatBytes = (size: number) => {
  if (!Number.isFinite(size)) return "";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)) - 1);
  const value = size / 1024 ** (index + 1);
  return `${value.toFixed(1)} ${units[index]}`;
};
const formatAnnotations = (annotations: unknown) => {
  if (!annotations) return "";
  try {
    const raw = JSON.stringify(annotations);
    return raw.length > 200 ? `${raw.slice(0, 197)}...` : raw;
  } catch {
    return "annotations";
  }
};
const guessLanguage = (mimeType?: string, uri?: string): BundledLanguage => {
  if (mimeType && MIME_LANGUAGE_MAP[mimeType]) {
    return MIME_LANGUAGE_MAP[mimeType];
  }
  if (uri) {
    const cleaned = uri.split(/[?#]/)[0];
    const ext = cleaned.split(".").pop()?.toLowerCase();
    if (ext && EXT_LANGUAGE_MAP[ext]) {
      return EXT_LANGUAGE_MAP[ext];
    }
  }
  return "plaintext";
};

const getBlockKey = (block: StoredContentBlock, index: number) => {
  switch (block.type) {
    case "image":
    case "audio":
      return `${block.type}:${block.uri ?? ""}:${block.mimeType}:${block.data.slice(
        0,
        24
      )}`;
    case "resource":
      return `resource:${block.resource.uri}:${block.resource.mimeType ?? ""}:${
        block.resource.text?.slice(0, 24) ?? block.resource.blob?.slice(0, 24) ?? index
      }`;
    case "resource_link":
      return `resource_link:${block.uri}:${block.name}:${block.size ?? ""}`;
    default:
      return `block:${index}`;
  }
};

const BlockMeta = ({
  mimeType,
  size,
  annotations,
}: {
  mimeType?: string | null;
  size?: number | null;
  annotations?: unknown;
}) => {
  const annotationText = formatAnnotations(annotations);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {mimeType ? <Badge variant="secondary">{mimeType}</Badge> : null}
      {typeof size === "number" ? (
        <Badge variant="secondary">{formatBytes(size)}</Badge>
      ) : null}
      {annotations ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline">annotations</Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs break-words text-xs">{annotationText}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  );
};

const CopyButton = ({
  value,
  label,
}: {
  value?: string;
  label: string;
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const Icon = isCopied ? CheckIcon : CopyIcon;
  const disabled = !value;

  const handleCopy = async () => {
    if (!value || typeof navigator === "undefined") {
      return;
    }
    if (!navigator.clipboard?.writeText) {
      return;
    }
    await navigator.clipboard.writeText(value);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={label}
            disabled={disabled}
            onClick={handleCopy}
            size="icon-sm"
            variant="ghost"
          >
            <Icon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{isCopied ? "Copied" : label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const ImageBlockView = ({ block }: { block: ImageBlock }) => {
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
        <BlockMeta mimeType={block.mimeType} annotations={block.annotations} />
      </div>
    </div>
  );
};

const AudioBlockView = ({ block }: { block: AudioBlock }) => {
  const src =
    buildDataUrl(block.mimeType, block.data) ?? getRenderableUri(block.uri);
  const title = getFileName(block.uri, "audio");
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      {src ? (
        <audio className="w-full" controls src={src} />
      ) : (
        <div className="text-muted-foreground text-xs">Audio unavailable</div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="truncate text-xs">{title}</span>
        <BlockMeta mimeType={block.mimeType} annotations={block.annotations} />
      </div>
    </div>
  );
};

const ResourceLinkBlockView = ({ block }: { block: ResourceLinkBlock }) => {
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
};

const ResourceBlockView = ({ block }: { block: ResourceBlock }) => {
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
};

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
