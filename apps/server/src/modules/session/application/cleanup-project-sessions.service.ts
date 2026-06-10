import { terminateProcessGracefully } from "@/shared/utils/process-termination.util";
import { terminateSessionTerminals } from "@/shared/utils/session-cleanup.util";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import { assertSessionMutationLock } from "./session-runtime-lock.assert";

const OP = "session.lifecycle.cleanup_project_sessions";

/**
 * Identifies the user-owned project whose stored and live sessions must be removed.
 *
 * Invariant: callers pass both the project id and canonical project path because
 * older sessions may only be linked by `projectRoot`.
 */
export interface CleanupProjectSessionsInput {
  userId: string;
  projectId: string;
  projectPath: string;
}

/**
 * Deletes every session associated with a project and tears down matching runtimes.
 *
 * Side effect ordering: live terminals are stopped under the session mutation
 * lock, the agent process is terminated, runtime state is removed, then the
 * persisted session record is deleted for the owning user.
 */
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
        await this.sessionRuntime.runExclusive(session.id, () => {
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
