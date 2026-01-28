import type { SessionRepositoryPort } from "./ports/session-repository.port";

export class UpdateSessionMetaService {
  private readonly sessionRepo: SessionRepositoryPort;

  constructor(sessionRepo: SessionRepositoryPort) {
    this.sessionRepo = sessionRepo;
  }

  execute(input: {
    chatId: string;
    name?: string | null;
    pinned?: boolean;
    archived?: boolean;
  }) {
    this.sessionRepo.updateMetadata(input.chatId, {
      name: input.name ?? undefined,
      pinned: input.pinned,
      archived: input.archived,
    });
    return { ok: true };
  }
}
