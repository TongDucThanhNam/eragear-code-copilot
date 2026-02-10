/**
 * Cancel Prompt Service
 *
 * Cancels an ongoing prompt execution in a session and resolves any pending
 * permission requests with a cancelled outcome.
 *
 * @module modules/ai/application/cancel-prompt.service
 */

import type { SessionRuntimePort } from "@/modules/session";
import { AppError } from "@/shared/errors";
import { AiChatSessionAggregate } from "../domain/ai-chat-session.aggregate";
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
    const session = this.sessionGateway.requireAuthorizedSession({
      userId,
      chatId,
      module: "ai",
      op: OP,
    });

    const aggregate = new AiChatSessionAggregate(session);
    aggregate.markCancelling({
      chatId,
      broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
    });

    try {
      await this.sessionGateway.cancelPrompt(session);
    } catch (error) {
      if (
        error instanceof AiSessionRuntimeError &&
        (error.kind === "process_exited" ||
          error.kind === "session_unavailable")
      ) {
        await this.sessionGateway.stopAndCleanup({
          chatId,
          session,
          reason: error.message || "Failed to cancel prompt",
          turnId: session.activeTurnId,
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

    this.sessionGateway.clearPendingPermissionsAsCancelled(session);
    return { ok: true };
  }
}
