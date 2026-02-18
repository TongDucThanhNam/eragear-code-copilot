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
import {
  getBlockProviderMetadata,
  getOptionalAnnotations,
  getOptionalMeta,
  getResourceMeta,
  mergeProviderMetadata,
} from "./metadata";

export function appendTextPart(
  message: UIMessage,
  text: string,
  state: TextUIPart["state"],
  providerMetadata?: ProviderMetadata
) {
  if (!text) {
    return;
  }
  const last = message.parts.at(-1);
  if (last?.type === "text" && last.state === state) {
    last.text += text;
    if (providerMetadata) {
      last.providerMetadata = mergeProviderMetadata(
        last.providerMetadata,
        providerMetadata
      );
    }
    return;
  }
  const part: TextUIPart = providerMetadata
    ? { type: "text", text, state, providerMetadata }
    : { type: "text", text, state };
  message.parts.push(part);
}

export function appendReasoningPart(
  message: UIMessage,
  text: string,
  state: ReasoningUIPart["state"],
  providerMetadata?: ProviderMetadata
) {
  if (!text) {
    return;
  }
  const last = message.parts.at(-1);
  if (last?.type === "reasoning") {
    last.text += text;
    last.state = state;
    if (providerMetadata) {
      last.providerMetadata = mergeProviderMetadata(
        last.providerMetadata,
        providerMetadata
      );
    }
    return;
  }
  const part: ReasoningUIPart = providerMetadata
    ? { type: "reasoning", text, state, providerMetadata }
    : { type: "reasoning", text, state };
  message.parts.push(part);
}

export function appendReasoningBlock(
  message: UIMessage,
  block: StoredContentBlock,
  state: ReasoningUIPart["state"],
  providerMetadata?: ProviderMetadata
) {
  if (block.type !== "text") {
    return;
  }
  const combinedMetadata = mergeProviderMetadata(
    getBlockProviderMetadata(block),
    providerMetadata
  );
  appendReasoningPart(message, block.text, state, combinedMetadata);
}

export function appendContentBlock(
  message: UIMessage,
  block: StoredContentBlock,
  state: TextUIPart["state"],
  providerMetadata?: ProviderMetadata
) {
  if (block.type === "text") {
    const combinedMetadata = mergeProviderMetadata(
      getBlockProviderMetadata(block),
      providerMetadata
    );
    appendTextPart(message, block.text, state, combinedMetadata);
    return;
  }
  const parts = contentBlockToParts(block, providerMetadata);
  if (parts.length > 0) {
    message.parts.push(...parts);
  }
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
  const message: UIMessage = {
    id: params.messageId,
    role: "user",
    parts: [],
  };
  for (const block of params.contentBlocks) {
    appendContentBlock(message, block, "done");
  }
  return message;
}

export function buildAssistantMessageFromBlocks(params: {
  messageId: string;
  contentBlocks: StoredContentBlock[];
  reasoningBlocks?: StoredContentBlock[];
}): UIMessage {
  const message: UIMessage = {
    id: params.messageId,
    role: "assistant",
    parts: [],
  };
  for (const block of params.reasoningBlocks ?? []) {
    appendReasoningBlock(message, block, "done");
  }
  for (const block of params.contentBlocks) {
    appendContentBlock(message, block, "done");
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
  try {
    const parsed = new URL(uri);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.at(-1);
  } catch {
    const segments = uri.split("/").filter(Boolean);
    return segments.at(-1);
  }
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
