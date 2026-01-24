import type { SessionRepositoryPort } from "../../../shared/types/ports";

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
