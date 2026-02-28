import type { SessionBufferingPort } from "@/modules/session";
import type { StoredContentBlock } from "../../shared/types/session.types";
import { createId } from "../../shared/utils/id.util";

const STREAM_BUFFER_TEXT_MAX_CHARS = 1024 * 1024;
const STREAM_BUFFER_BLOCK_MAX = 2048;
const STREAM_BUFFER_TRUNCATED_PREFIX = "[...truncated...]\n";

function contentBlockToText(content: StoredContentBlock) {
  if (content.type !== "text") {
    return "";
  }
  return content.text;
}

function appendChunkWithCap(params: {
  chunks: string[];
  currentLength: number;
  nextChunk: string;
}): number {
  if (!params.nextChunk) {
    return params.currentLength;
  }
  params.chunks.push(params.nextChunk);
  let nextLength = params.currentLength + params.nextChunk.length;
  if (nextLength <= STREAM_BUFFER_TEXT_MAX_CHARS) {
    return nextLength;
  }
  const joined = params.chunks.join("");
  const joinedWithoutPrefix = joined.startsWith(STREAM_BUFFER_TRUNCATED_PREFIX)
    ? joined.slice(STREAM_BUFFER_TRUNCATED_PREFIX.length)
    : joined;
  const tailBudget = Math.max(
    0,
    STREAM_BUFFER_TEXT_MAX_CHARS - STREAM_BUFFER_TRUNCATED_PREFIX.length
  );
  const tail = joinedWithoutPrefix.slice(
    Math.max(0, joinedWithoutPrefix.length - tailBudget)
  );
  const truncated = `${STREAM_BUFFER_TRUNCATED_PREFIX}${tail}`;
  params.chunks.length = 0;
  params.chunks.push(truncated);
  nextLength = truncated.length;
  return nextLength;
}

function trimBlocksWithCap(blocks: StoredContentBlock[]): void {
  if (blocks.length <= STREAM_BUFFER_BLOCK_MAX) {
    return;
  }
  blocks.splice(0, blocks.length - STREAM_BUFFER_BLOCK_MAX);
}

/**
 * SessionBuffering - Buffers streaming message content for aggregation.
 *
 * Uses chunk arrays for text aggregation to reduce repeated string reallocations
 * during long streaming responses. Tracks chunk-level statistics for raw ACP
 * logging so callers can emit aggregated "part complete" summaries.
 */
export class SessionBuffering implements SessionBufferingPort {
  private contentChunks: string[] = [];
  private reasoningChunks: string[] = [];
  private pendingReasoningChunks: string[] = [];
  private contentBlocks: StoredContentBlock[] = [];
  private reasoningBlocks: StoredContentBlock[] = [];
  private pendingReasoningBlocks: StoredContentBlock[] = [];
  private messageId: string | null = null;
  private contentTextLength = 0;
  private reasoningTextLength = 0;
  private pendingReasoningTextLength = 0;
  /** Count of replay events processed during history replay */
  replayEventCount = 0;

  // ── Chunk statistics for aggregated raw ACP logging ──
  private contentChunkCount = 0;
  private reasoningChunkCount = 0;
  private contentStartedAt: number | null = null;
  private reasoningStartedAt: number | null = null;

  appendContent(block: StoredContentBlock) {
    this.appendBlock("content", block);
  }

  appendReasoning(block: StoredContentBlock) {
    this.appendBlock("reasoning", block);
  }

  consumePendingReasoning(): {
    text: string;
    blocks: StoredContentBlock[];
    chunkCount: number;
    durationMs: number | null;
  } | null {
    if (this.pendingReasoningBlocks.length === 0) {
      this.pendingReasoningChunks = [];
      this.pendingReasoningTextLength = 0;
      return null;
    }
    const blocks = this.pendingReasoningBlocks;
    const text = this.pendingReasoningChunks.join("");
    const stats = this.consumeReasoningStats();
    this.pendingReasoningBlocks = [];
    this.pendingReasoningChunks = [];
    this.pendingReasoningTextLength = 0;
    return {
      text,
      blocks,
      ...stats,
    };
  }

  /**
   * Returns aggregated statistics for consumed content/reasoning chunks.
   * Useful for raw ACP logging to emit "part complete" summaries.
   */
  getContentStats(): {
    contentChunkCount: number;
    contentTextLength: number;
    contentDurationMs: number | null;
  } {
    return {
      contentChunkCount: this.contentChunkCount,
      contentTextLength: this.contentTextLength,
      contentDurationMs: this.contentStartedAt
        ? Date.now() - this.contentStartedAt
        : null,
    };
  }

  /**
   * Resets content chunk statistics after logging.
   */
  resetContentStats(): void {
    this.contentChunkCount = 0;
    this.contentStartedAt = null;
  }

  private consumeReasoningStats(): {
    chunkCount: number;
    durationMs: number | null;
  } {
    const stats = {
      chunkCount: this.reasoningChunkCount,
      durationMs: this.reasoningStartedAt
        ? Date.now() - this.reasoningStartedAt
        : null,
    };
    this.reasoningChunkCount = 0;
    this.reasoningStartedAt = null;
    return stats;
  }

  hasPendingReasoning() {
    return this.pendingReasoningBlocks.length > 0;
  }

  flush(): ReturnType<SessionBufferingPort["flush"]> {
    if (!this.hasContent()) {
      this.reset();
      return null;
    }

    const messageId = this.messageId ?? createId("msg");
    const content = this.contentChunks.join("");
    const reasoning = this.reasoningChunks.length
      ? this.reasoningChunks.join("")
      : undefined;
    const contentBlocks = this.contentBlocks;
    const reasoningBlocks =
      this.reasoningBlocks.length > 0 ? this.reasoningBlocks : undefined;

    this.contentChunks = [];
    this.reasoningChunks = [];
    this.pendingReasoningChunks = [];
    this.contentBlocks = [];
    this.reasoningBlocks = [];
    this.pendingReasoningBlocks = [];
    this.messageId = null;
    this.contentTextLength = 0;
    this.reasoningTextLength = 0;
    this.pendingReasoningTextLength = 0;
    this.contentChunkCount = 0;
    this.reasoningChunkCount = 0;
    this.contentStartedAt = null;
    this.reasoningStartedAt = null;

    return {
      id: messageId,
      content,
      contentBlocks,
      reasoning,
      reasoningBlocks,
    };
  }

  hasContent() {
    return this.contentBlocks.length > 0 || this.reasoningBlocks.length > 0;
  }

  reset() {
    this.contentChunks = [];
    this.reasoningChunks = [];
    this.pendingReasoningChunks = [];
    this.contentBlocks = [];
    this.reasoningBlocks = [];
    this.pendingReasoningBlocks = [];
    this.messageId = null;
    this.contentTextLength = 0;
    this.reasoningTextLength = 0;
    this.pendingReasoningTextLength = 0;
    this.contentChunkCount = 0;
    this.reasoningChunkCount = 0;
    this.contentStartedAt = null;
    this.reasoningStartedAt = null;
  }

  getMessageId() {
    return this.messageId;
  }

  ensureMessageId(preferredId?: string) {
    if (!this.messageId) {
      this.messageId = preferredId ?? createId("msg");
    }
    return this.messageId;
  }

  private appendBlock(
    target: "content" | "reasoning",
    block: StoredContentBlock
  ) {
    if (target === "content") {
      this.contentBlocks.push(block);
      trimBlocksWithCap(this.contentBlocks);
      this.contentChunkCount += 1;
      if (!this.contentStartedAt) {
        this.contentStartedAt = Date.now();
      }
    } else {
      this.reasoningBlocks.push(block);
      this.pendingReasoningBlocks.push(block);
      trimBlocksWithCap(this.reasoningBlocks);
      trimBlocksWithCap(this.pendingReasoningBlocks);
      this.reasoningChunkCount += 1;
      if (!this.reasoningStartedAt) {
        this.reasoningStartedAt = Date.now();
      }
    }

    const text = contentBlockToText(block);
    if (text) {
      if (target === "content") {
        this.contentTextLength = appendChunkWithCap({
          chunks: this.contentChunks,
          currentLength: this.contentTextLength,
          nextChunk: text,
        });
      } else {
        this.reasoningTextLength = appendChunkWithCap({
          chunks: this.reasoningChunks,
          currentLength: this.reasoningTextLength,
          nextChunk: text,
        });
        this.pendingReasoningTextLength = appendChunkWithCap({
          chunks: this.pendingReasoningChunks,
          currentLength: this.pendingReasoningTextLength,
          nextChunk: text,
        });
      }
    }

    if (!this.messageId) {
      this.messageId = createId("msg");
    }
  }
}
