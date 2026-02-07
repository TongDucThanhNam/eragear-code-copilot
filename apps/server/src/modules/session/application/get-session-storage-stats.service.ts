import type { SessionRepositoryPort } from "./ports/session-repository.port";

export class GetSessionStorageStatsService {
  private readonly sessionRepo: SessionRepositoryPort;

  constructor(sessionRepo: SessionRepositoryPort) {
    this.sessionRepo = sessionRepo;
  }

  execute() {
    return this.sessionRepo.getStorageStats();
  }
}
