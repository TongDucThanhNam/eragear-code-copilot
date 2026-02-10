import { NotFoundError } from "@/shared/errors";
import type { SessionRepositoryPort } from "./ports/session-repository.port";

const OP = "session.meta.update";

export class UpdateSessionMetaService {
  private readonly sessionRepo: SessionRepositoryPort;

  constructor(sessionRepo: SessionRepositoryPort) {
    this.sessionRepo = sessionRepo;
  }

  async execute(input: {
    userId: string;
    chatId: string;
    name?: string | null;
    pinned?: boolean;
    archived?: boolean;
  }): Promise<{ ok: true }> {
    const stored = await this.sessionRepo.findById(input.chatId, input.userId);
    if (!stored) {
      throw new NotFoundError("Chat not found", {
        module: "session",
        op: OP,
        details: { chatId: input.chatId },
      });
    }
    await this.sessionRepo.updateMetadata(input.chatId, input.userId, {
      name: input.name ?? undefined,
      pinned: input.pinned,
      archived: input.archived,
    });
    return { ok: true };
  }
}
