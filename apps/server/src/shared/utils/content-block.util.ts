/**
 * Content Block Utilities
 *
 * Helpers to normalize ACP content blocks for JSON storage and replay.
 *
 * @module shared/utils/content-block.util
 */

import type { ContentBlock, ResourceLink } from "@agentclientprotocol/sdk";
import type { StoredContentBlock } from "../types/session.types";

/**
 * Convert an ACP ContentBlock into a JSON-safe StoredContentBlock.
 *
 * ACP models use bigint for resource sizes, but JSON cannot encode bigint.
 * This normalizes sizes to numbers when safe, otherwise omits them.
 */
export function toStoredContentBlock(block: ContentBlock): StoredContentBlock {
  if (block.type !== "resource_link") {
    return block as StoredContentBlock;
  }

  return {
    ...block,
    size: normalizeResourceLinkSize(block.size),
  };
}

/**
 * Convert an array of ACP ContentBlocks into JSON-safe StoredContentBlocks.
 */
export function toStoredContentBlocks(
  blocks: ContentBlock[]
): StoredContentBlock[] {
  return blocks.map(toStoredContentBlock);
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
