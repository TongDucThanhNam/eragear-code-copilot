import type { SessionRepositoryPort } from "../../../shared/types/ports";

export class GetSessionMessagesService {
  constructor(private sessionRepo: SessionRepositoryPort) {}

  execute(chatId: string) {
    return this.sessionRepo.getMessages(chatId);
  }
}
