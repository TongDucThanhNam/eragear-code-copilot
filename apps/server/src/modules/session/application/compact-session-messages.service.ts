import type { SessionRepositoryPort } from "./ports/session-repository.port";

export interface CompactSessionMessagesInput {
  beforeTimestamp: number;
  batchSize: number;
}

export interface CompactSessionMessagesResult {
  compacted: number;
  candidateCount: number;
  stoppedSessionCount: number;
}

export class CompactSessionMessagesService {
  private readonly sessionRepo: SessionRepositoryPort;

  constructor(sessionRepo: SessionRepositoryPort) {
    this.sessionRepo = sessionRepo;
  }

  async execute(
    input: CompactSessionMessagesInput
  ): Promise<CompactSessionMessagesResult> {
    const sessions = await this.sessionRepo.findAllForMaintenance();
    const stoppedSessionIds = sessions
      .filter((session) => session.status === "stopped")
      .map((session) => session.id);

    if (stoppedSessionIds.length === 0) {
      return {
        compacted: 0,
        candidateCount: sessions.length,
        stoppedSessionCount: 0,
      };
    }

    const result = await this.sessionRepo.compactMessages({
      beforeTimestamp: input.beforeTimestamp,
      batchSize: input.batchSize,
      sessionIds: stoppedSessionIds,
    });

    return {
      compacted: result.compacted,
      candidateCount: sessions.length,
      stoppedSessionCount: stoppedSessionIds.length,
    };
  }
}
