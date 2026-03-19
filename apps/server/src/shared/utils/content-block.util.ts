/**
 * Content Block Utilities
 *
 * Helpers to normalize ACP content blocks for JSON storage and replay.
 *
 * @module shared/utils/content-block.util
 */

import type {
  ContentBlock,
  ResourceLink,
  ToolCallContent,
} from "@agentclientprotocol/sdk";
import {
  type BlobRef,
  storeInlineBlobSync,
} from "@/platform/storage/blob-store";
import type { StoredContentBlock } from "../types/session.types";

export const MAX_INLINE_BINARY_BASE64_CHARS = 64 * 1024;
const INLINE_BINARY_META_KEY = "eragearInlineBinary";

export interface StoredContentContext {
  userId: string;
  chatId: string;
}

/**
 * Convert an ACP ContentBlock into a JSON-safe StoredContentBlock.
 *
 * ACP models use bigint for resource sizes, but JSON cannot encode bigint.
 * This normalizes sizes to numbers when safe, otherwise omits them.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Content block conversion requires complex type handling
export function toStoredContentBlock(
  block: ContentBlock,
  context?: StoredContentContext
): StoredContentBlock {
  if (block.type === "resource_link") {
    return {
      ...block,
      size: normalizeResourceLinkSize(block.size),
    };
  }

  if (block.type === "image" || block.type === "audio") {
    if (block.data.length <= MAX_INLINE_BINARY_BASE64_CHARS) {
      return block as StoredContentBlock;
    }
    const existingUri =
      "uri" in block && typeof block.uri === "string" && block.uri.length > 0
        ? block.uri
        : undefined;
    const blobRef =
      context?.userId && context.chatId
        ? storeInlineBlobSync({
            userId: context.userId,
            chatId: context.chatId,
            base64: block.data,
            mimeType: block.mimeType,
            source: block.type === "image" ? "image" : "audio",
          })
        : null;
    const nextUri = blobRef?.url ?? existingUri;
    return withInlineBinaryMeta(
      {
        ...block,
        data: "",
        ...(nextUri ? { uri: nextUri } : {}),
      } as StoredContentBlock,
      {
        field: "data",
        omitted: true,
        base64Chars: block.data.length,
        maxBase64Chars: MAX_INLINE_BINARY_BASE64_CHARS,
        blobRef: blobRef ?? undefined,
      }
    );
  }

  if (
    block.type === "resource" &&
    "blob" in block.resource &&
    typeof block.resource.blob === "string" &&
    block.resource.blob.length > MAX_INLINE_BINARY_BASE64_CHARS
  ) {
    const existingResourceUri =
      typeof block.resource.uri === "string" && block.resource.uri.length > 0
        ? block.resource.uri
        : undefined;
    const blobRef =
      context?.userId && context.chatId
        ? storeInlineBlobSync({
            userId: context.userId,
            chatId: context.chatId,
            base64: block.resource.blob,
            mimeType: block.resource.mimeType ?? undefined,
            source: "resource",
          })
        : null;
    const nextResourceUri = blobRef?.url ?? existingResourceUri;
    return {
      ...block,
      resource: withInlineBinaryMeta(
        {
          ...block.resource,
          ...(nextResourceUri ? { uri: nextResourceUri } : {}),
          blob: "",
        },
        {
          field: "blob",
          omitted: true,
          base64Chars: block.resource.blob.length,
          maxBase64Chars: MAX_INLINE_BINARY_BASE64_CHARS,
          blobRef: blobRef ?? undefined,
        }
      ) as typeof block.resource,
    } as StoredContentBlock;
  }

  return block as StoredContentBlock;
}

function withInlineBinaryMeta<T extends Record<string, unknown>>(
  target: T,
  marker: {
    field: "data" | "blob";
    omitted: true;
    base64Chars: number;
    maxBase64Chars: number;
    blobRef?: BlobRef;
  }
): T {
  const currentMeta =
    "_meta" in target && target._meta && typeof target._meta === "object"
      ? (target._meta as Record<string, unknown>)
      : {};
  return {
    ...target,
    _meta: {
      ...currentMeta,
      [INLINE_BINARY_META_KEY]: marker,
    },
  };
}

/**
 * Convert an array of ACP ContentBlocks into JSON-safe StoredContentBlocks.
 */
export function toStoredContentBlocks(
  blocks: ContentBlock[],
  context?: StoredContentContext
): StoredContentBlock[] {
  return blocks.map((block) => toStoredContentBlock(block, context));
}

/**
 * Convert tool call content blocks into JSON-safe content.
 */
export function toStoredToolCallContent(
  content?: ToolCallContent[] | null,
  context?: StoredContentContext
): ToolCallContent[] | undefined {
  if (content === null) {
    return undefined;
  }
  if (!content) {
    return content;
  }
  return content.map((item) => {
    if (item.type !== "content") {
      return item;
    }
    return {
      ...item,
      content: toStoredContentBlock(item.content, context),
    } as ToolCallContent;
  });
}

function normalizeResourceLinkSize(
  size: ResourceLink["size"] | number | undefined
): number | null | undefined {
  if (size === null || size === undefined) {
    return size ?? undefined;
  }
  if (typeof size === "bigint") {
    const asNumber = Number(size);
    return Number.isSafeInteger(asNumber) ? asNumber : undefined;
  }
  if (typeof size === "number") {
    return Number.isFinite(size) ? size : undefined;
  }
  return undefined;
}
