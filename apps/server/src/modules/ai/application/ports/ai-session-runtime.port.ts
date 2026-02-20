import type {
  ContentBlock,
  SessionConfigOption,
} from "@agentclientprotocol/sdk";
import type { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import type { ChatSession } from "@/shared/types/session.types";

export type AiSessionRuntimeErrorKind =
  | "retryable_transport"
  | "process_exited"
  | "session_unavailable"
  | "method_not_supported"
  | "unknown";

export class AiSessionRuntimeError extends Error {
  readonly kind: AiSessionRuntimeErrorKind;
  readonly details: Record<string, unknown> | undefined;

  constructor(params: {
    kind: AiSessionRuntimeErrorKind;
    message: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(params.message, { cause: params.cause });
    this.name = "AiSessionRuntimeError";
    this.kind = params.kind;
    this.details = params.details;
  }
}

export interface AiRequireSessionInput {
  userId: string;
  chatId: string;
  module: string;
  op: string;
  details?: Record<string, unknown>;
}

export interface AiAssertSessionRunningInput {
  chatId: string;
  session: ChatSession;
  module: string;
  op: string;
  details?: Record<string, unknown>;
}

export interface AiStopSessionInput {
  chatId: string;
  session: ChatSession;
  reason: string;
  turnId?: string;
  killProcess: boolean;
}

export interface AiSessionRuntimePort {
  requireAuthorizedSession(input: AiRequireSessionInput): ChatSession;
  requireAuthorizedRuntime(input: AiRequireSessionInput): SessionRuntimeEntity;
  assertSessionRunning(input: AiAssertSessionRunningInput): void;
  prompt(
    session: ChatSession,
    prompt: ContentBlock[],
    options?: { maxTokens?: number }
  ): Promise<{ stopReason: string }>;
  cancelPrompt(session: ChatSession): Promise<void>;
  setSessionMode(session: ChatSession, modeId: string): Promise<void>;
  setSessionModel(session: ChatSession, modelId: string): Promise<void>;
  setSessionConfigOption(
    session: ChatSession,
    configId: string,
    value: string
  ): Promise<SessionConfigOption[]>;
  stopAndCleanup(input: AiStopSessionInput): Promise<void>;
  clearPendingPermissionsAsCancelled(session: ChatSession): void;
}
