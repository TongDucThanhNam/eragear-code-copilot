import path from "node:path";
import type {
  DataUIPart,
  FileUIPart,
  ProviderMetadata,
  ReasoningUIPart,
  SourceDocumentUIPart,
  SourceUrlUIPart,
  TextUIPart,
  UIMessage,
  UIMessagePart,
} from "@repo/shared";
import type { StoredContentBlock } from "@/shared/types/session.types";
import { escapeHtmlText } from "../html.util";
import {
  getBlockProviderMetadata,
  getOptionalAnnotations,
  getOptionalMeta,
  getResourceMeta,
  mergeProviderMetadata,
} from "./metadata";

const WINDOWS_DRIVE_PATH_RE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH_RE = /^\\\\[^\\]+\\[^\\]+/;

export function appendTextPart(
  message: UIMessage,
  text: string,
  state: TextUIPart["state"],
  providerMetadata?: ProviderMetadata
): UIMessage {
  const escapedText = escapeHtmlText(text);
  if (!escapedText) {
    return message;
  }
  const lastIndex = message.parts.length - 1;
  const last = message.parts[lastIndex];
  if (last?.type === "text" && last.state === state) {
    const updatedLast: TextUIPart = {
      ...last,
      text: `${last.text}${escapedText}`,
      ...(providerMetadata
        ? {
            providerMetadata: mergeProviderMetadata(
              last.providerMetadata,
              providerMetadata
            ),
          }
        : {}),
    };
    const nextParts = [...message.parts];
    nextParts[lastIndex] = updatedLast;
    return {
      ...message,
      parts: nextParts,
    };
  }
  const part: TextUIPart = providerMetadata
    ? { type: "text", text: escapedText, state, providerMetadata }
    : { type: "text", text: escapedText, state };
  return {
    ...message,
    parts: [...message.parts, part],
  };
}

export function appendReasoningPart(
  message: UIMessage,
  text: string,
  state: ReasoningUIPart["state"],
  providerMetadata?: ProviderMetadata
): UIMessage {
  const escapedText = escapeHtmlText(text);
  if (!escapedText) {
    return message;
  }
  const lastIndex = message.parts.length - 1;
  const last = message.parts[lastIndex];
  if (last?.type === "reasoning") {
    const updatedLast: ReasoningUIPart = {
      ...last,
      text: `${last.text}${escapedText}`,
      state,
      ...(providerMetadata
        ? {
            providerMetadata: mergeProviderMetadata(
              last.providerMetadata,
              providerMetadata
            ),
          }
        : {}),
    };
    const nextParts = [...message.parts];
    nextParts[lastIndex] = updatedLast;
    return {
      ...message,
      parts: nextParts,
    };
  }
  const part: ReasoningUIPart = providerMetadata
    ? { type: "reasoning", text: escapedText, state, providerMetadata }
    : { type: "reasoning", text: escapedText, state };
  return {
    ...message,
    parts: [...message.parts, part],
  };
}

export function appendReasoningBlock(
  message: UIMessage,
  block: StoredContentBlock,
  state: ReasoningUIPart["state"],
  providerMetadata?: ProviderMetadata
): UIMessage {
  if (block.type !== "text") {
    return message;
  }
  const combinedMetadata = mergeProviderMetadata(
    getBlockProviderMetadata(block),
    providerMetadata
  );
  return appendReasoningPart(message, block.text, state, combinedMetadata);
}

export function appendContentBlock(
  message: UIMessage,
  block: StoredContentBlock,
  state: TextUIPart["state"],
  providerMetadata?: ProviderMetadata
): UIMessage {
  if (block.type === "text") {
    const combinedMetadata = mergeProviderMetadata(
      getBlockProviderMetadata(block),
      providerMetadata
    );
    return appendTextPart(message, block.text, state, combinedMetadata);
  }
  const parts = contentBlockToParts(block, providerMetadata);
  if (parts.length > 0) {
    return {
      ...message,
      parts: [...message.parts, ...parts],
    };
  }
  return message;
}

export function contentBlockToParts(
  block: StoredContentBlock,
  providerMetadata?: ProviderMetadata
): UIMessagePart[] {
  switch (block.type) {
    case "resource_link": {
      const mergedProviderMetadata = mergeProviderMetadata(
        getBlockProviderMetadata(block),
        providerMetadata
      );
      const part: SourceUrlUIPart = {
        type: "source-url",
        sourceId: block.uri,
        url: block.uri,
        title: block.title ?? block.name ?? block.uri,
        providerMetadata: mergedProviderMetadata,
      };
      return [part];
    }
    case "resource": {
      const resource = block.resource;
      const title = resource.uri ?? "Resource";
      const resourceMeta = getResourceMeta(resource);
      const mergedProviderMetadata = mergeProviderMetadata(
        getBlockProviderMetadata(block, resourceMeta),
        providerMetadata
      );
      const part: SourceDocumentUIPart = {
        type: "source-document",
        sourceId: resource.uri ?? title,
        mediaType: resource.mimeType ?? "text/plain",
        title,
        filename: filenameFromUri(resource.uri),
        providerMetadata: mergedProviderMetadata,
      };
      const dataPart = buildResourceDataPart(block, resource);
      return dataPart ? [part, dataPart] : [part];
    }
    case "image":
    case "audio": {
      const uri = "uri" in block ? block.uri : undefined;
      const url = uri ?? toDataUrl(block.mimeType, block.data);
      if (!url) {
        return [];
      }
      const mergedProviderMetadata = mergeProviderMetadata(
        getBlockProviderMetadata(block),
        providerMetadata
      );
      const part: FileUIPart = {
        type: "file",
        mediaType: block.mimeType,
        url,
        filename: filenameFromUri(uri),
        providerMetadata: mergedProviderMetadata,
      };
      return [part];
    }
    default:
      return [];
  }
}

export function buildUserMessageFromBlocks(params: {
  messageId: string;
  contentBlocks: StoredContentBlock[];
}): UIMessage {
  let message: UIMessage = {
    id: params.messageId,
    role: "user",
    parts: [],
  };
  for (const block of params.contentBlocks) {
    message = appendContentBlock(message, block, "done");
  }
  return message;
}

export function buildAssistantMessageFromBlocks(params: {
  messageId: string;
  contentBlocks: StoredContentBlock[];
  reasoningBlocks?: StoredContentBlock[];
}): UIMessage {
  let message: UIMessage = {
    id: params.messageId,
    role: "assistant",
    parts: [],
  };
  for (const block of params.reasoningBlocks ?? []) {
    message = appendReasoningBlock(message, block, "done");
  }
  for (const block of params.contentBlocks) {
    message = appendContentBlock(message, block, "done");
  }
  return message;
}

function buildResourceDataPart(
  block: Extract<StoredContentBlock, { type: "resource" }>,
  resource: Extract<StoredContentBlock, { type: "resource" }>["resource"]
): DataUIPart | null {
  const hasText = "text" in resource && typeof resource.text === "string";
  const hasBlob = "blob" in resource && typeof resource.blob === "string";
  if (!(hasText || hasBlob)) {
    return null;
  }
  const data: Record<string, unknown> = {
    uri: resource.uri,
    mimeType: resource.mimeType,
  };
  if (hasText) {
    data.text = resource.text;
  }
  if (hasBlob) {
    data.blob = resource.blob;
  }
  const meta = getOptionalMeta(block);
  const annotations = getOptionalAnnotations(block);
  if (meta !== undefined) {
    data._meta = meta;
  }
  if (annotations !== undefined) {
    data.annotations = annotations;
  }
  const resourceMeta = getResourceMeta(resource);
  if (resourceMeta !== undefined) {
    data.resourceMeta = resourceMeta;
  }
  return { type: "data-resource", data };
}

function filenameFromUri(uri?: string | null): string | undefined {
  if (!uri) {
    return undefined;
  }
  const normalizedUri = uri.trim();
  if (!normalizedUri) {
    return undefined;
  }
  if (isWindowsPathLike(normalizedUri)) {
    return toFilename(normalizedUri);
  }
  try {
    const parsed = new URL(normalizedUri);
    return toFilename(parsed.pathname);
  } catch {
    return toFilename(normalizedUri);
  }
}

function toFilename(pathLike: string): string | undefined {
  const basename = isWindowsPathLike(pathLike)
    ? path.win32.basename(pathLike)
    : path.posix.basename(pathLike);
  if (basename === "" || basename === "." || basename === "..") {
    return undefined;
  }
  return basename;
}

function isWindowsPathLike(pathLike: string): boolean {
  return (
    WINDOWS_DRIVE_PATH_RE.test(pathLike) || WINDOWS_UNC_PATH_RE.test(pathLike)
  );
}

function toDataUrl(
  mimeType?: string | null,
  data?: string | null
): string | null {
  if (!(mimeType && data)) {
    return null;
  }
  return `data:${mimeType};base64,${data}`;
}
