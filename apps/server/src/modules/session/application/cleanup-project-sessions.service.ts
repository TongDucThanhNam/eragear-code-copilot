import { terminateProcessGracefully } from "@/shared/utils/process-termination.util";
import { terminateSessionTerminals } from "@/shared/utils/session-cleanup.util";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import { assertSessionMutationLock } from "./session-runtime-lock.assert";

const OP = "session.lifecycle.cleanup_project_sessions";

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
        await this.sessionRuntime.runExclusive(session.id, async () => {
          assertSessionMutationLock({
            sessionRuntime: this.sessionRuntime,
            chatId: session.id,
            op: OP,
          });
          const current = this.sessionRuntime.get(session.id);
          if (!current || current !== runtimeSession) {
            return;
          }
          await terminateSessionTerminals(current);
        });
        await terminateProcessGracefully(runtimeSession.proc, {
          forceWindowsTreeTermination: true,
        });
        await this.sessionRuntime.runExclusive(session.id, async () => {
          assertSessionMutationLock({
            sessionRuntime: this.sessionRuntime,
            chatId: session.id,
            op: OP,
          });
          this.sessionRuntime.deleteIfMatch(session.id, runtimeSession);
        });
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
