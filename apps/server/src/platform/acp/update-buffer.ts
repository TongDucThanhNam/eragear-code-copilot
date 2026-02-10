import type { SessionBufferingPort } from "@/modules/session";
import type { StoredContentBlock } from "../../shared/types/session.types";
import { createId } from "../../shared/utils/id.util";

function contentBlockToText(content: StoredContentBlock) {
  if (content.type !== "text") {
    return "";
  }
  return content.text;
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
    } else {
      this.reasoningBlocks.push(block);
    }

    const text = contentBlockToText(block);
    if (text) {
      if (target === "content") {
        this.contentChunks.push(text);
      } else {
        this.reasoningChunks.push(text);
      }
    }

    if (!this.messageId) {
      this.messageId = createId("msg");
    }
  }
}
