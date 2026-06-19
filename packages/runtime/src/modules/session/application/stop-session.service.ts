import { NotFoundError } from "#runtime/shared/errors";
import { terminateProcessGracefully } from "../../../shared/utils/process-termination.util";
import { terminateSessionTerminals } from "../../../shared/utils/session-cleanup.util";
import { SessionRuntimeEntity } from "../domain/session-runtime.entity";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import type { SessionLifecycleNotifier } from "./session-lifecycle.notifier";
import { assertSessionMutationLock } from "./session-runtime-lock.assert";

const OP = "session.lifecycle.stop";

/**
 * Stops a running session without deleting persisted history.
 *
 * Ordering contract: terminal cleanup and inactive broadcast happen under the
 * runtime lock before process termination; persisted status is updated after the
 * runtime session is removed.
 */
export class StopSessionService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionLifecycleNotifier: SessionLifecycleNotifier;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    sessionLifecycleNotifier: SessionLifecycleNotifier
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.sessionLifecycleNotifier = sessionLifecycleNotifier;
  }

  async execute(userId: string, chatId: string): Promise<{ ok: true }> {
    let runtimeSession:
      | NonNullable<ReturnType<SessionRuntimePort["get"]>>
      | undefined;
    await this.sessionRuntime.runExclusive(chatId, async () => {
      assertSessionMutationLock({
        sessionRuntime: this.sessionRuntime,
        chatId,
        op: OP,
      });
      const session = this.sessionRuntime.get(chatId);
      if (!session || session.userId !== userId) {
        return;
      }
      runtimeSession = session;
      await terminateSessionTerminals(session);
      await new SessionRuntimeEntity(session).markInactive({
        chatId,
        broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
      });
    });

    if (runtimeSession) {
      const sessionToDelete = runtimeSession;
      await terminateProcessGracefully(sessionToDelete.proc, {
        forceWindowsTreeTermination: true,
      });
      await this.sessionRuntime.runExclusive(chatId, () => {
        assertSessionMutationLock({
          sessionRuntime: this.sessionRuntime,
          chatId,
          op: OP,
        });
        this.sessionRuntime.deleteIfMatch(chatId, sessionToDelete);
        return Promise.resolve();
      });
    }

    const stored = await this.sessionRepo.findById(chatId, userId);
    if (!stored) {
      throw new NotFoundError("Chat not found", {
        module: "session",
        op: OP,
        details: { chatId },
      });
    }
    await this.sessionRepo.updateStatus(chatId, userId, "stopped");
    await this.sessionLifecycleNotifier.agentSessionStopped({
      userId,
      projectRoot: runtimeSession?.projectRoot ?? stored.projectRoot,
      ...((runtimeSession?.projectId ?? stored.projectId)
        ? { projectId: runtimeSession?.projectId ?? stored.projectId }
        : {}),
      chatId,
      ...((runtimeSession?.sessionId ?? stored.sessionId)
        ? { agentSessionId: runtimeSession?.sessionId ?? stored.sessionId }
        : {}),
    });
    return { ok: true };
  }
}
