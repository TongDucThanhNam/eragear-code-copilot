import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "../../../shared/types/ports";

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
      session.proc.kill();
    }
    this.sessionRepo.updateStatus(chatId, "stopped");
    return { ok: true };
  }
}
