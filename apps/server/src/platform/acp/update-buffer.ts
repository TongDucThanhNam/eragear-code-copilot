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
 * during long streaming responses.
 */
export class SessionBuffering implements SessionBufferingPort {
  private contentChunks: string[] = [];
  private reasoningChunks: string[] = [];
  private contentBlocks: StoredContentBlock[] = [];
  private reasoningBlocks: StoredContentBlock[] = [];
  private messageId: string | null = null;
  private contentTextLength = 0;
  private reasoningTextLength = 0;
  /** Count of replay events processed during history replay */
  replayEventCount = 0;

  appendContent(block: StoredContentBlock) {
    this.appendBlock("content", block);
  }

  appendReasoning(block: StoredContentBlock) {
    this.appendBlock("reasoning", block);
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
    this.contentBlocks = [];
    this.reasoningBlocks = [];
    this.messageId = null;
    this.contentTextLength = 0;
    this.reasoningTextLength = 0;

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
    this.contentBlocks = [];
    this.reasoningBlocks = [];
    this.messageId = null;
    this.contentTextLength = 0;
    this.reasoningTextLength = 0;
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
    } else {
      this.reasoningBlocks.push(block);
      trimBlocksWithCap(this.reasoningBlocks);
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
      }
    }

    if (!this.messageId) {
      this.messageId = createId("msg");
    }
  }
}
