/**
 * Cancel Prompt Service
 *
 * Cancels an ongoing prompt execution in a session and resolves any pending
 * permission requests with a cancelled outcome.
 *
 * @module modules/ai/application/cancel-prompt.service
 */

import type { SessionRuntimePort } from "@/modules/session";
import { assertSessionMutationLock } from "@/modules/session/application/session-runtime-lock.assert";
import { AppError } from "@/shared/errors";
import type { ChatSession } from "@/shared/types/session.types";
import { AI_OP, HTTP_STATUS } from "./ai.constants";
import type { AiSessionRuntimePort } from "./ports/ai-session-runtime.port";
import { AiSessionRuntimeError } from "./ports/ai-session-runtime.port";

const OP = AI_OP.PROMPT_CANCEL;

export class CancelPromptService {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionGateway: AiSessionRuntimePort;

  constructor(
    sessionRuntime: SessionRuntimePort,
    sessionGateway: AiSessionRuntimePort
  ) {
    this.sessionRuntime = sessionRuntime;
    this.sessionGateway = sessionGateway;
  }

  async execute(userId: string, chatId: string) {
    const activeSession = await this.sessionRuntime.runExclusive(
      chatId,
      async (): Promise<ChatSession> => {
        assertSessionMutationLock({
          sessionRuntime: this.sessionRuntime,
          chatId,
          op: OP,
        });
        const aggregate = this.sessionGateway.requireAuthorizedRuntime({
          userId,
          chatId,
          module: "ai",
          op: OP,
        });
        await aggregate.markCancelling({
          chatId,
          broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
        });
        return aggregate.raw;
      }
    );

    try {
      await this.sessionGateway.cancelPrompt(activeSession);
    } catch (error) {
      if (
        error instanceof AiSessionRuntimeError &&
        (error.kind === "process_exited" ||
          error.kind === "session_unavailable")
      ) {
        await this.sessionGateway.stopAndCleanup({
          chatId,
          session: activeSession,
          reason: error.message || "Failed to cancel prompt",
          turnId: activeSession.activeTurnId,
          killProcess: error.kind === "process_exited",
        });
        return { ok: true };
      }

      throw new AppError({
        message:
          error instanceof Error
            ? error.message
            : "Failed to cancel active prompt",
        code: "PROMPT_CANCEL_FAILED",
        statusCode: HTTP_STATUS.BAD_GATEWAY,
        module: "ai",
        op: OP,
        cause: error,
        details: { chatId },
      });
    }

    await this.sessionRuntime.runExclusive(chatId, async () => {
      assertSessionMutationLock({
        sessionRuntime: this.sessionRuntime,
        chatId,
        op: OP,
      });
      const currentSession = this.sessionRuntime.get(chatId);
      if (!currentSession || currentSession !== activeSession) {
        return;
      }
      this.sessionGateway.clearPendingPermissionsAsCancelled(currentSession);
    });
    return { ok: true };
  }
}
