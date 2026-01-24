import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "../../../shared/types/ports";
import { terminateSessionTerminals } from "../../../shared/utils/session-cleanup.util";

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
      session.proc.kill();
      // Remove from runtime so getSessionState returns "stopped"
      this.sessionRuntime.delete(chatId);
    }
    this.sessionRepo.updateStatus(chatId, "stopped");
    return { ok: true };
  }
}
