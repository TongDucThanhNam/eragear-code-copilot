import { updateChatStatus } from "../../../shared/utils/chat-events.util";
import { terminateSessionTerminals } from "../../../shared/utils/session-cleanup.util";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

export class StopSessionService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
  }

  execute(chatId: string): { ok: true } {
    const session = this.sessionRuntime.get(chatId);
    if (session) {
      console.log(`[tRPC] Stopping session ${chatId}`);
      terminateSessionTerminals(session);
      updateChatStatus({
        chatId,
        session,
        broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
        status: "inactive",
      });
      session.proc.kill();
      // Remove from runtime so getSessionState returns "stopped"
      this.sessionRuntime.delete(chatId);
    }
    this.sessionRepo.updateStatus(chatId, "stopped");
    return { ok: true };
  }
}
