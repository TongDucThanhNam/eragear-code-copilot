import type { SessionRepositoryPort } from "./ports/session-repository.port";

const COMPACTION_SESSION_PAGE_SIZE = 500;

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
    let candidateCount = 0;
    const stoppedSessionIds: string[] = [];
    let cursor: string | undefined;

    while (true) {
      const page = await this.sessionRepo.findPageForMaintenance({
        limit: COMPACTION_SESSION_PAGE_SIZE,
        cursor,
      });
      if (page.sessions.length === 0) {
        break;
      }

      candidateCount += page.sessions.length;
      for (const session of page.sessions) {
        if (session.status === "stopped") {
          stoppedSessionIds.push(session.id);
        }
      }

      if (!(page.hasMore && page.nextCursor)) {
        break;
      }
      cursor = page.nextCursor;
    }

    if (stoppedSessionIds.length === 0) {
      return {
        compacted: 0,
        candidateCount,
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
      candidateCount,
      stoppedSessionCount: stoppedSessionIds.length,
    };
  }
}
