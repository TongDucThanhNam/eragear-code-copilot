import { terminateSessionTerminals } from "@/shared/utils/session-cleanup.util";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

export interface CleanupProjectSessionsInput {
  userId: string;
  projectId: string;
  projectPath: string;
}

export class CleanupProjectSessionsService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
  }

  async execute(input: CleanupProjectSessionsInput): Promise<{
    deletedSessionIds: string[];
    terminatedRuntimeCount: number;
  }> {
    const sessions = await this.sessionRepo.findAll(input.userId);
    const linkedSessions = sessions.filter(
      (session) =>
        session.projectId === input.projectId ||
        session.projectRoot === input.projectPath
    );

    let terminatedRuntimeCount = 0;
    const deletedSessionIds: string[] = [];

    for (const session of linkedSessions) {
      const runtimeSession = this.sessionRuntime.get(session.id);
      if (runtimeSession) {
        terminateSessionTerminals(runtimeSession);
        if (!runtimeSession.proc.killed) {
          runtimeSession.proc.kill("SIGTERM");
        }
        this.sessionRuntime.delete(session.id);
        terminatedRuntimeCount += 1;
      }

      await this.sessionRepo.delete(session.id, input.userId);
      deletedSessionIds.push(session.id);
    }

    return {
      deletedSessionIds,
      terminatedRuntimeCount,
    };
  }
}
