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
  flush(): BufferedMessage | null;
  hasContent(): boolean;
  reset(): void;
  getMessageId(): string | null;
  ensureMessageId(preferredId?: string): string;
}

export interface SessionAcpPort {
  createBuffer(): SessionBufferingPort;
  createHandlers(params: {
    chatId: string;
    buffer: SessionBufferingPort;
    getIsReplaying: () => boolean;
    sessionRuntime: SessionRuntimePort;
    sessionRepo: SessionRepositoryPort;
  }): acp.Client;
}
