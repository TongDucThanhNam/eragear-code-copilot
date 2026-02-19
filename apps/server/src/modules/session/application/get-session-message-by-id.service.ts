/**
 * Get Session Message By ID Service
 *
 * Retrieves a single message for a specific session.
 *
 * @module modules/session/application/get-session-message-by-id.service
 */

import { NotFoundError } from "@/shared/errors";
import { mapStoredMessageToUiMessage } from "./get-session-messages.service";
import type { SessionRepositoryPort } from "./ports/session-repository.port";

const OP = "session.message.get_by_id";

export class GetSessionMessageByIdService {
  private readonly sessionRepo: SessionRepositoryPort;

  constructor(sessionRepo: SessionRepositoryPort) {
    this.sessionRepo = sessionRepo;
  }

  async execute(input: { userId: string; chatId: string; messageId: string }) {
    const stored = await this.sessionRepo.findById(input.chatId, input.userId);
    if (!stored) {
      throw new NotFoundError("Chat not found", {
        module: "session",
        op: OP,
        details: { chatId: input.chatId },
      });
    }

    const message = await this.sessionRepo.getMessageById(
      input.chatId,
      input.userId,
      input.messageId
    );

    return {
      message: message ? mapStoredMessageToUiMessage(message) : undefined,
    };
  }
}
