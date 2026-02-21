import { NotFoundError } from "@/shared/errors";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import { updateChatStatus } from "../../../shared/utils/chat-events.util";
import { terminateProcessGracefully } from "../../../shared/utils/process-termination.util";
import { terminateSessionTerminals } from "../../../shared/utils/session-cleanup.util";
import { assertSessionMutationLock } from "./session-runtime-lock.assert";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

const OP = "session.lifecycle.stop";

export class StopSessionService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly eventBus: EventBusPort;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    eventBus: EventBusPort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.eventBus = eventBus;
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
      await updateChatStatus({
        chatId,
        session,
        broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
        status: "inactive",
      });
    });

    if (runtimeSession) {
      const sessionToDelete = runtimeSession;
      await terminateProcessGracefully(sessionToDelete.proc, {
        forceWindowsTreeTermination: true,
      });
      await this.sessionRuntime.runExclusive(chatId, async () => {
        assertSessionMutationLock({
          sessionRuntime: this.sessionRuntime,
          chatId,
          op: OP,
        });
        this.sessionRuntime.deleteIfMatch(chatId, sessionToDelete);
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
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "session_stopped",
      userId,
      chatId,
    });
    return { ok: true };
  }
}
