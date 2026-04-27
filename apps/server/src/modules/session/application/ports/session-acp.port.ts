import type * as acp from "@agentclientprotocol/sdk";
import type { StoredContentBlock } from "@/modules/session/domain/stored-session.types";
import type { SessionRepositoryPort } from "./session-repository.port";
import type { SessionRuntimePort } from "./session-runtime.port";

export interface BufferedMessage {
  id: string;
  content: string;
  contentBlocks: StoredContentBlock[];
  reasoning?: string;
  reasoningBlocks?: StoredContentBlock[];
}

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
