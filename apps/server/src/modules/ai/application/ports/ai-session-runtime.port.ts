import type {
  ContentBlock,
  SessionConfigOption,
} from "@agentclientprotocol/sdk";
import type { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import type { ChatSession } from "@/shared/types/session.types";

/**
 * Error categories that AI use-cases can map to retry/cancel/user-visible flows.
 *
 * Caller contract: adapters should use the most specific kind available so
 * prompt orchestration can distinguish transient transport failures from a
 * permanently unavailable runtime.
 */
export type AiSessionRuntimeErrorKind =
  | "retryable_transport"
  | "cancelled"
  | "process_exited"
  | "session_unavailable"
  | "method_not_supported"
  | "unknown";

/**
 * Runtime adapter error thrown across the AI/session seam.
 *
 * Error mode: `kind` is stable for policy decisions; `message` and `details`
 * are diagnostic and should not be parsed for control flow.
 */
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

/**
 * Input for user-scoped runtime session lookup.
 *
 * Invariant: `module` and `op` are propagated into typed errors so transport
 * and logs can identify the failing use-case.
 */
export interface AiRequireSessionInput {
  userId: string;
  chatId: string;
  module: string;
  op: string;
  details?: Record<string, unknown>;
}

/**
 * Input for asserting that an authorized session can accept runtime work.
 *
 * Error mode: adapters should throw typed application/runtime errors rather
 * than silently no-op when the session is stopped or unavailable.
 */
export interface AiAssertSessionRunningInput {
  chatId: string;
  session: ChatSession;
  module: string;
  op: string;
  details?: Record<string, unknown>;
}

/**
 * Stop request passed from AI orchestration into the runtime adapter.
 *
 * Ordering requirement: pending permission cleanup and terminal/process cleanup
 * must happen before the session is marked ready/stopped for client reuse.
 */
export interface AiStopSessionInput {
  chatId: string;
  session: ChatSession;
  reason: string;
  turnId?: string;
  killProcess: boolean;
}

/**
 * AI-facing session runtime adapter.
 *
 * Contract: authorization checks, ACP prompt/config calls, cancellation, and
 * cleanup stay behind this port so `SendMessageService` can orchestrate prompt
 * ordering without importing platform ACP/process code.
 */
export interface AiSessionRuntimePort {
  requireAuthorizedSession(input: AiRequireSessionInput): ChatSession;
  requireAuthorizedRuntime(input: AiRequireSessionInput): SessionRuntimeEntity;
  assertSessionRunning(input: AiAssertSessionRunningInput): void;
  prompt(
    session: ChatSession,
    prompt: ContentBlock[],
    options?: { maxTokens?: number; signal?: AbortSignal }
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
