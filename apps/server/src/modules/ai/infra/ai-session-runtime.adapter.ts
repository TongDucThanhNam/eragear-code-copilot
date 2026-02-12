import type { ContentBlock } from "@agentclientprotocol/sdk";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import { AppError, NotFoundError } from "@/shared/errors";
import type { ChatSession } from "@/shared/types/session.types";
import { updateChatStatus } from "@/shared/utils/chat-events.util";
import type {
  AiAssertSessionRunningInput,
  AiRequireSessionInput,
  AiSessionRuntimePort,
  AiStopSessionInput,
} from "../application/ports/ai-session-runtime.port";
import { AiSessionRuntimeError } from "../application/ports/ai-session-runtime.port";
import {
  classifyAcpError,
  getAcpErrorText,
  isMethodNotFound,
} from "./acp-error.mapper";

interface ConnWithUnstableModel {
  unstable_setSessionModel: (params: {
    sessionId: string;
    modelId: string;
  }) => Promise<void>;
}

export class AiSessionRuntimeAdapter implements AiSessionRuntimePort {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionRepo: SessionRepositoryPort;

  constructor(
    sessionRuntime: SessionRuntimePort,
    sessionRepo: SessionRepositoryPort
  ) {
    this.sessionRuntime = sessionRuntime;
    this.sessionRepo = sessionRepo;
  }

  requireAuthorizedSession(input: AiRequireSessionInput): ChatSession {
    const session = this.sessionRuntime.get(input.chatId);
    if (!session?.sessionId || session.userId !== input.userId) {
      throw new NotFoundError("Chat not found", {
        module: input.module,
        op: input.op,
        details: { chatId: input.chatId, ...input.details },
      });
    }
    return session;
  }

  requireAuthorizedRuntime(input: AiRequireSessionInput): SessionRuntimeEntity {
    return new SessionRuntimeEntity(this.requireAuthorizedSession(input));
  }

  assertSessionRunning(input: AiAssertSessionRunningInput): void {
    const { session, module, op, chatId, details } = input;
    const runtime = new SessionRuntimeEntity(session);
    try {
      runtime.assertProcessRunning(module, op, chatId);
      runtime.assertConnectionOpen(module, op, chatId);
    } catch (error) {
      if (error instanceof AppError && details) {
        throw new AppError({
          message: error.message,
          code: error.code,
          statusCode: error.statusCode,
          module: error.module,
          op: error.op,
          details: { ...(error.details ?? {}), ...details },
          cause: error,
        });
      }
      throw error;
    }
  }

  prompt(
    session: ChatSession,
    prompt: ContentBlock[],
    options?: { maxTokens?: number }
  ): Promise<{ stopReason: string }> {
    const maxTokens =
      options?.maxTokens !== undefined
        ? Math.max(1, Math.trunc(options.maxTokens))
        : undefined;
    const meta =
      maxTokens !== undefined
        ? {
            maxTokens,
            max_tokens: maxTokens,
          }
        : undefined;
    return this.wrapAcpCall(() =>
      session.conn.prompt({
        sessionId: session.sessionId ?? "",
        prompt,
        ...(meta ? { _meta: meta } : {}),
      })
    );
  }

  async cancelPrompt(session: ChatSession): Promise<void> {
    await this.wrapAcpCall(() =>
      session.conn.cancel({
        sessionId: session.sessionId ?? "",
      })
    );
  }

  async setSessionMode(session: ChatSession, modeId: string): Promise<void> {
    await this.wrapAcpCall(
      () =>
        session.conn.setSessionMode({
          sessionId: session.sessionId ?? "",
          modeId,
        }),
      { classifyMethodNotSupported: true }
    );
  }

  async setSessionModel(session: ChatSession, modelId: string): Promise<void> {
    await this.wrapAcpCall(
      () =>
        (
          session.conn as unknown as ConnWithUnstableModel
        ).unstable_setSessionModel({
          sessionId: session.sessionId ?? "",
          modelId,
        }),
      { classifyMethodNotSupported: true }
    );
  }

  async stopAndCleanup(input: AiStopSessionInput): Promise<void> {
    const { chatId, session, reason, killProcess, turnId } = input;
    await this.sessionRuntime.broadcast(chatId, {
      type: "error",
      error: reason,
    });
    await updateChatStatus({
      chatId,
      session,
      broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
      status: "error",
      ...(turnId ? { turnId } : {}),
    });
    await this.sessionRepo.updateStatus(chatId, session.userId, "stopped");
    session.activeTurnId = undefined;
    session.activePromptTask = undefined;
    if (killProcess && !session.proc.killed) {
      session.proc.kill();
    }
    this.sessionRuntime.delete(chatId);
  }

  clearPendingPermissionsAsCancelled(session: ChatSession): void {
    new SessionRuntimeEntity(session).cancelPendingPermissionsAsCancelled();
  }

  private async wrapAcpCall<T>(
    work: () => Promise<T>,
    options?: { classifyMethodNotSupported?: boolean }
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw this.mapAcpError(error, options);
    }
  }

  private mapAcpError(
    error: unknown,
    options?: { classifyMethodNotSupported?: boolean }
  ): AiSessionRuntimeError {
    const text = getAcpErrorText(error);
    if (options?.classifyMethodNotSupported && isMethodNotFound(text)) {
      return new AiSessionRuntimeError({
        kind: "method_not_supported",
        message: text || "Method not supported by agent",
        cause: error,
      });
    }

    const classified = classifyAcpError(error);
    if (classified.kind === "retryable_transport") {
      return new AiSessionRuntimeError({
        kind: "retryable_transport",
        message: classified.text || "Transport is temporarily unavailable",
        cause: error,
      });
    }
    if (classified.kind === "fatal_process") {
      return new AiSessionRuntimeError({
        kind: "process_exited",
        message: classified.text || "Agent process exited",
        cause: error,
      });
    }
    if (classified.kind === "fatal_session") {
      return new AiSessionRuntimeError({
        kind: "session_unavailable",
        message: classified.text || "Agent session is unavailable",
        cause: error,
      });
    }

    return new AiSessionRuntimeError({
      kind: "unknown",
      message:
        classified.text ||
        (error instanceof Error ? error.message : "Unknown ACP failure"),
      cause: error,
    });
  }
}
