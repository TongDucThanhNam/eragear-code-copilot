/**
 * Delete Session Service
 *
 * Handles the removal of a session, including terminating any running
 * agent process and cleaning up both runtime and persistent storage.
 *
 * @module modules/session/application/delete-session.service
 */

import { NotFoundError } from "../../../shared/errors";
import { terminateProcessGracefully } from "../../../shared/utils/process-termination.util";
import { terminateSessionTerminals } from "../../../shared/utils/session-cleanup.util";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import type { SessionLifecycleNotifier } from "./session-lifecycle.notifier";
import { assertSessionMutationLock } from "./session-runtime-lock.assert";

const OP = "session.lifecycle.delete";

/**
 * DeleteSessionService
 *
 * Deletes runtime and persisted state for one session.
 *
 * Ordering contract: running terminals are terminated under the lock, the agent
 * process is stopped before runtime deletion, then persisted state is removed
 * and a session-deleted notification is reported.
 */
export class DeleteSessionService {
  /** Repository for session persistence */
  private readonly sessionRepo: SessionRepositoryPort;
  /** Runtime store for active sessions */
  private readonly sessionRuntime: SessionRuntimePort;
  /** Notifier for session lifecycle notifications */
  private readonly sessionLifecycleNotifier: SessionLifecycleNotifier;

  /**
   * Creates a DeleteSessionService with required dependencies
   */
  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    sessionLifecycleNotifier: SessionLifecycleNotifier
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.sessionLifecycleNotifier = sessionLifecycleNotifier;
  }

  /**
   * Deletes a session by ID
   *
   * If the session is currently active, terminates the agent process
   * and removes it from the runtime store. Always removes from persistent storage.
   *
   * @param chatId - The chat session identifier to delete
   * @returns Success status object
   *
   * @example
   * ```typescript
   * const result = await service.execute("chat-123");
   * if (result.ok) {
   *   console.log("Session deleted successfully");
   * }
   * ```
   */
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
    await this.sessionRepo.delete(chatId, userId);
    await this.sessionLifecycleNotifier.sessionDeleted({
      userId,
      chatId,
    });
    return { ok: true };
  }
}
