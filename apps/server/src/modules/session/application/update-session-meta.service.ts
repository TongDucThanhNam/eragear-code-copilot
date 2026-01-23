import type { SessionRepositoryPort } from "../../../shared/types/ports";

export class UpdateSessionMetaService {
  constructor(private sessionRepo: SessionRepositoryPort) {}

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
