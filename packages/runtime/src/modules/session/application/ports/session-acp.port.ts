import type * as acp from "@agentclientprotocol/sdk";
import type { StoredContentBlock } from "#runtime/modules/session/domain/stored-session.types";
import type { SessionRepositoryPort } from "./session-repository.port";
import type { SessionRuntimePort } from "./session-runtime.port";

/**
 * Buffered assistant message snapshot waiting to be flushed to storage/UI.
 *
 * Invariant: content and reasoning blocks preserve ACP ordering; callers should
 * flush/reset through `SessionBufferingPort` rather than mutate this shape.
 */
export interface BufferedMessage {
  id: string;
  content: string;
  contentBlocks: StoredContentBlock[];
  reasoning?: string;
  reasoningBlocks?: StoredContentBlock[];
}

/**
 * Per-message ACP stream buffer.
 *
 * Ordering contract: append methods are called in ACP event order, `flush`
 * consumes the current assistant message, and stats reset is separate from
 * content reset so raw logging can observe chunk metrics.
 */
export interface SessionBufferingPort {
  replayEventCount: number;
  appendContent(block: StoredContentBlock): void;
  appendReasoning(block: StoredContentBlock): void;
  consumePendingReasoning(): {
    text: string;
    blocks: StoredContentBlock[];
    chunkCount: number;
    durationMs: number | null;
  } | null;
  hasPendingReasoning(): boolean;
  flush(): BufferedMessage | null;
  hasContent(): boolean;
  reset(): void;
  getMessageId(): string | null;
  ensureMessageId(preferredId?: string): string;
  /** Returns aggregated statistics for content chunks (for raw ACP logging). */
  getContentStats(): {
    contentChunkCount: number;
    contentTextLength: number;
    contentDurationMs: number | null;
  };
  /** Resets content chunk statistics after logging. */
  resetContentStats(): void;
}

/**
 * Session ACP adapter port.
 *
 * Contract: platform handlers are created behind this port so application
 * bootstrap can wire permissions, message buffering, runtime state, and
 * persistence without importing concrete ACP implementation details.
 */
export interface SessionAcpPort {
  createBuffer(): SessionBufferingPort;
  setPermissionAutoResolver(
    resolver:
      | ((input: { chatId: string; requestId: string }) => Promise<void>)
      | undefined
  ): void;
  createHandlers(params: {
    chatId: string;
    buffer: SessionBufferingPort;
    getIsReplaying: () => boolean;
    sessionRuntime: SessionRuntimePort;
    sessionRepo: SessionRepositoryPort;
    permissionAutoResolver?: (input: {
      chatId: string;
      requestId: string;
    }) => Promise<void>;
  }): acp.Client;
}
